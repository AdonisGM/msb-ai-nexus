import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  max,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { canAssignTo, customerScope } from '../auth/scope'
import { DB, type Db } from '../db/db.module'
import {
  customers,
  opportunities,
  signals,
  users,
  type Customer,
  type User,
} from '../db/schema'
import { isUniqueViolation } from '../lib/db-errors'
import type { CreateCustomerDto, ListCustomersDto, UpdateCustomerDto } from './dto'

/** What a caller gets when they ask for a page without saying how big.
 *  Matches the web app's own default, so the first screen a person sees holds
 *  exactly one page and the two sides never disagree about what page 2 is. */
export const DEFAULT_PAGE_SIZE = 10

/** How a customer's leads stand, at a glance.
 *
 *  The four buckets are disjoint and add up to `total`. That is the whole
 *  contract, and it is load-bearing: the screen draws them as one stacked bar
 *  and as one donut, so overlapping buckets do not read as a subtle
 *  inaccuracy — the bar overflows its track and the percentages pass 100.
 *
 *  Hence `open` means "still open AND somebody has called it", with the ones
 *  nobody has called counted only under `untouched`. Defining `open` as every
 *  live lead would be the more obvious reading of the word and would double
 *  count every untouched one. */
export type LeadSummary = {
  total: number
  /** Live, and somebody has rung it. */
  open: number
  won: number
  lost: number
  /** Live, and nobody has rung it yet. */
  untouched: number
}

/** Sent for a customer with no leads at all, so the screen never has to check
 *  for a missing object before reading a number off it. */
const EMPTY_LEAD_SUMMARY: LeadSummary = { total: 0, open: 0, won: 0, lost: 0, untouched: 0 }

/** The four buckets, written once.
 *
 *  Used by the per-customer roll-up and by the totals across a whole filtered
 *  set. Two copies of this arithmetic is two chances for the number on a card
 *  to disagree with the bar on the row beneath it. */
const LEAD_BUCKETS = {
  total: count(),
  open: sql<number>`count(*) filter (
    where ${opportunities.outcome} = 'open' and ${opportunities.contactedAt} is not null
  )`,
  won: sql<number>`count(*) filter (where ${opportunities.outcome} = 'won')`,
  lost: sql<number>`count(*) filter (where ${opportunities.outcome} = 'lost')`,
  untouched: sql<number>`count(*) filter (
    where ${opportunities.outcome} = 'open' and ${opportunities.contactedAt} is null
  )`,
}

/** The SQL behind one of the four buckets, for the "has a lead standing like
 *  this" filter. Same definitions as LEAD_BUCKETS, so a chip and the bar on
 *  the row it filters to can never disagree. */
function bucketCondition(bucket: string): SQL {
  switch (bucket) {
    case 'won':
      return sql`${opportunities.outcome} = 'won'`
    case 'lost':
      return sql`${opportunities.outcome} = 'lost'`
    case 'untouched':
      return sql`${opportunities.outcome} = 'open' and ${opportunities.contactedAt} is null`
    default:
      return sql`${opportunities.outcome} = 'open' and ${opportunities.contactedAt} is not null`
  }
}

function readBuckets(row: Record<string, unknown>): LeadSummary {
  return {
    total: Number(row.total ?? 0),
    open: Number(row.open ?? 0),
    won: Number(row.won ?? 0),
    lost: Number(row.lost ?? 0),
    untouched: Number(row.untouched ?? 0),
  }
}

@Injectable()
export class CustomersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** One page of the customers this person may see.
   *
   *  Scope is applied first and unconditionally; the caller's filters are
   *  added on top with `and`, never in place of it. */
  async list(user: User, query: ListCustomersDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE

    const where = this.whereFor(user, query)
    const owner = alias(users, 'owner')

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(customers),
          /** Whose book this is, by name. A team lead or a branch manager
           *  looking at a mixed list otherwise sees rows with no owner on
           *  them, and an id they cannot read. */
          ownerName: owner.name,
        })
        .from(customers)
        .innerJoin(owner, eq(owner.id, customers.ownerId))
        .where(where)
        .orderBy(desc(customers.updatedAt), asc(customers.code))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(customers).where(where),
    ])

    /** Two aggregates over the page, rather than correlated subqueries on
     *  every row of the table. The page is twenty-five rows; the table is
     *  every customer in the branch. */
    const ids = rows.map((row) => row.id)
    const [leads, lastSignal, summary] = await Promise.all([
      this.leadSummaryFor(ids),
      this.lastSignalFor(ids),
      this.summaryFor(where),
    ])

    return {
      rows: rows.map((row) => ({
        ...row,
        leads: leads.get(row.id) ?? EMPTY_LEAD_SUMMARY,
        /** When anything was last heard about this customer.
         *
         *  Three weeks of silence on a file is the signal itself — it is what
         *  a team lead chases and what the model will rank a day's calls by.
         *  Null means nothing has ever been recorded, which is a louder
         *  version of the same thing. */
        lastSignalAt: lastSignal.get(row.id) ?? null,
      })),
      summary,
      total,
      page,
      pageSize,
    }
  }

  /** The totals the cards above the table are made of.
   *
   *  Counted across everything the filter matched, not across the page. The
   *  distinction is the entire point: a donut that only knew about the
   *  twenty-five rows currently on screen would change every time somebody
   *  paged, and would be wrong on all of them but the first.
   *
   *  The revenue sum is here for the same reason — "tổng doanh thu" under a
   *  filtered table means the filtered total, and adding up one page of it is
   *  a number that is never right and never obviously wrong. */
  private async summaryFor(where: SQL | undefined) {
    const matched = this.db.select({ id: customers.id }).from(customers).where(where)

    const [[money], [buckets]] = await Promise.all([
      this.db
        .select({
          /** `coalesce` because summing no rows is null, and a screen reading
           *  null as "0 đồng" is luck rather than design. */
          revenue: sql<number>`coalesce(sum(${customers.revenue}), 0)`.mapWith(Number),
        })
        .from(customers)
        .where(where),
      this.db
        .select(LEAD_BUCKETS)
        .from(opportunities)
        .where(inArray(opportunities.customerId, matched)),
    ])

    return { revenue: Number(money?.revenue ?? 0), leads: readBuckets(buckets ?? {}) }
  }

  /** How each customer's leads stand, counted in one pass.
   *
   *  `untouched` is here rather than left to the screen because it is the
   *  number that makes a list actionable: a customer with four leads and
   *  nobody having rung any of them reads very differently from one with four
   *  in progress. */
  private async leadSummaryFor(ids: string[]) {
    const summary = new Map<string, LeadSummary>()
    if (ids.length === 0) return summary

    const rows = await this.db
      .select({
        customerId: opportunities.customerId,
        ...LEAD_BUCKETS,
      })
      .from(opportunities)
      .where(inArray(opportunities.customerId, ids))
      .groupBy(opportunities.customerId)

    for (const row of rows) summary.set(row.customerId, readBuckets(row))

    return summary
  }

  private async lastSignalFor(ids: string[]) {
    const latest = new Map<string, Date>()
    if (ids.length === 0) return latest

    const rows = await this.db
      .select({ customerId: signals.customerId, at: max(signals.observedAt) })
      .from(signals)
      .where(inArray(signals.customerId, ids))
      .groupBy(signals.customerId)

    for (const row of rows) if (row.at) latest.set(row.customerId, row.at)
    return latest
  }

  /** One customer, or a 404.
   *
   *  Out of scope is reported as missing rather than forbidden on purpose:
   *  "this exists but is not yours" already tells someone that a competitor's
   *  customer is on the books here. */
  async get(user: User, id: string) {
    const owner = alias(users, 'owner')

    const [row] = await this.db
      .select({ ...getTableColumns(customers), ownerName: owner.name })
      .from(customers)
      .innerJoin(owner, eq(owner.id, customers.ownerId))
      .where(and(eq(customers.id, id), customerScope(this.db, user)))
      .limit(1)

    if (!row) throw new NotFoundException('customer_not_found')

    /** The same three extras the list carries.
     *
     *  Sent here too because a detail screen that showed less than the row it
     *  was opened from reads as a step backwards — and because the four
     *  figures across the top of it are exactly these. */
    const [leads, lastSignal] = await Promise.all([
      this.leadSummaryFor([row.id]),
      this.lastSignalFor([row.id]),
    ])

    return {
      ...row,
      leads: leads.get(row.id) ?? EMPTY_LEAD_SUMMARY,
      lastSignalAt: lastSignal.get(row.id) ?? null,
    }
  }

  async create(user: User, body: CreateCustomerDto): Promise<Customer> {
    const ownerId = body.ownerId ?? user.id
    const owner = await this.resolveOwner(user, ownerId, body.segment)

    /** Two people creating in the same instant land on the same number. The
     *  unique index catches it; this walks to the next one rather than making
     *  the second person retype the form. */
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await this.db
          .insert(customers)
          .values({
            id: randomUUID(),
            code: await this.nextCode(body.segment, attempt),
            name: body.name,
            segment: body.segment,
            ownerId: owner.id,
            currentProducts: body.currentProducts ?? [],
            revenue: body.revenue ?? null,
            relationStage: body.relationStage ?? null,
            attributes: body.attributes ?? {},
            contactName: body.contactName ?? null,
            contactPhone: body.contactPhone ?? null,
            note: body.note ?? null,
          })
          .returning()

        return row
      } catch (error) {
        if (attempt >= 4 || !isUniqueViolation(error, 'customers_code_unique')) throw error
      }
    }
  }

  async update(user: User, id: string, body: UpdateCustomerDto): Promise<Customer> {
    /** Reads through the scope, so editing something out of reach fails as a
     *  404 before anything is written. */
    const current = await this.get(user, id)

    if (body.ownerId && body.ownerId !== current.ownerId) {
      await this.resolveOwner(user, body.ownerId, current.segment)
    }

    const [row] = await this.db
      .update(customers)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.ownerId !== undefined && { ownerId: body.ownerId }),
        ...(body.currentProducts !== undefined && { currentProducts: body.currentProducts }),
        ...(body.revenue !== undefined && { revenue: body.revenue }),
        ...(body.relationStage !== undefined && { relationStage: body.relationStage }),
        ...(body.attributes !== undefined && { attributes: body.attributes }),
        ...(body.contactName !== undefined && { contactName: body.contactName }),
        ...(body.contactPhone !== undefined && { contactPhone: body.contactPhone }),
        ...(body.note !== undefined && { note: body.note }),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning()

    return row
  }

  private whereFor(user: User, query: ListCustomersDto): SQL | undefined {
    const parts: (SQL | undefined)[] = [customerScope(this.db, user)]

    if (query.segment) parts.push(eq(customers.segment, query.segment))
    if (query.ownerId) parts.push(eq(customers.ownerId, query.ownerId))
    if (query.relationStage) parts.push(eq(customers.relationStage, query.relationStage))

    /** Accent-insensitive on both sides, so typing "ha" finds "Hà" and typing
     *  "Hà" finds a name someone entered without the accent. Vietnamese names
     *  get typed both ways and a search that only matches one is a search
     *  people stop using.
     *
     *  The contact's name and number are in here because the box says they
     *  are: people search for a customer by the person they actually spoke
     *  to, and by the number they are about to dial. */
    if (query.q) {
      const like = `%${query.q}%`
      parts.push(
        sql`(unaccent(${customers.name}) ilike unaccent(${like})
             or ${customers.code} ilike ${like}
             or unaccent(coalesce(${customers.contactName}, '')) ilike unaccent(${like})
             or coalesce(${customers.contactPhone}, '') ilike ${like})`,
      )
    }

    /** Which MSB products they already hold. An array containment test rather
     *  than a join, because that is how the column is stored. */
    if (query.product) {
      parts.push(sql`${customers.currentProducts} @> array[${query.product}]::text[]`)
    }

    /** Customers with at least one lead standing a particular way.
     *
     *  Deliberately "at least one", and the screen has to say so: a customer
     *  is not won or lost, their leads are. A chip reading "Hoàn thành 15"
     *  next to 9 rows is a support ticket, so the label belongs to the
     *  customer ("có cơ hội hoàn thành") and never to the count of leads. */
    if (query.hasLead) parts.push(sql`exists (
      select 1 from ${opportunities}
      where ${opportunities.customerId} = ${customers.id} and ${bucketCondition(query.hasLead)}
    )`)

    /** A date window on one of three columns, chosen by the caller.
     *
     *  `lastSignalAt` is not a column — it is the newest signal on the file —
     *  so it is asked for with a correlated subquery rather than joined and
     *  grouped. At a branch's volume that is the cheaper shape and by far the
     *  readable one; if it ever stops being cheap the fix is an index on
     *  (customer_id, observed_at), which already exists. */
    const field = query.dateField ?? 'lastSignalAt'
    const when =
      field === 'lastSignalAt'
        ? sql`(select max(${signals.observedAt}) from ${signals}
               where ${signals.customerId} = ${customers.id})`
        : field === 'createdAt'
          ? sql`${customers.createdAt}`
          : sql`${customers.updatedAt}`

    /** A customer nobody has ever recorded anything about has no last signal,
     *  and a window on that column must not silently drop them — "we have
     *  heard nothing since August" and "we have never heard anything" are the
     *  same worry, and the second one is worse. */
    if (query.from) parts.push(sql`(${when} >= ${query.from}::date or ${when} is null)`)
    if (query.to) parts.push(sql`(${when} < (${query.to}::date + 1) or ${when} is null)`)

    const defined = parts.filter((part): part is SQL => part !== undefined)
    return defined.length > 0 ? and(...defined) : undefined
  }

  /** The distinct values behind the two free-text pickers.
   *
   *  Read from the data rather than declared, because both columns are open:
   *  `relationStage` is typed by hand and `currentProducts` is a list the
   *  sales team extends. Scoped like everything else, so a salesperson's
   *  dropdown offers what appears in their own book and not the branch's.
   *
   *  It exists because the screen cannot build these lists itself: it holds
   *  one page of twenty-five rows and the options live across all of them. */
  async facets(user: User) {
    const scope = customerScope(this.db, user)

    const [stages, products] = await Promise.all([
      this.db
        .selectDistinct({ value: customers.relationStage })
        .from(customers)
        .where(scope ? and(scope, isNotNull(customers.relationStage)) : isNotNull(customers.relationStage))
        .orderBy(asc(customers.relationStage)),
      this.db
        .select({ value: sql<string>`distinct unnest(${customers.currentProducts})` })
        .from(customers)
        .where(scope),
    ])

    return {
      relationStages: stages.map((row) => row.value!).filter(Boolean),
      products: products.map((row) => row.value).filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi')),
    }
  }

  /** Checks that the caller may assign to this person, and that the person can
   *  actually hold a customer in that segment.
   *
   *  The segment rule exists because a customer's segment decides which
   *  pipeline their deals land in. An SSE customer in a retail salesperson's
   *  book would sit in a pipeline nobody reviews. */
  private async resolveOwner(actor: User, ownerId: string, segment: string) {
    if (!(await canAssignTo(this.db, actor, ownerId))) {
      throw new ForbiddenException('owner_out_of_scope')
    }

    const [owner] = await this.db.select().from(users).where(eq(users.id, ownerId)).limit(1)
    if (!owner) throw new NotFoundException('owner_not_found')

    if (owner.role !== 'sale' && owner.role !== 'team_lead') {
      throw new BadRequestException('owner_not_in_sales_line')
    }
    if (owner.segment !== segment) {
      throw new BadRequestException('owner_segment_mismatch')
    }

    return owner
  }

  /** CUS-SSE-001, numbered per segment.
   *
   *  Derived from the highest number in use rather than a database sequence,
   *  because these codes get read aloud in meetings and a sequence leaves gaps
   *  every time an insert rolls back. The trailing digits are parsed out, so a
   *  code that does not end in a number is simply ignored instead of breaking
   *  the next one. */
  private async nextCode(segment: string, attempt = 0): Promise<string> {
    const [row] = await this.db
      .select({
        highest: sql<number>`coalesce(max((substring(${customers.code} from '[0-9]+$'))::int), 0)`,
      })
      .from(customers)
      .where(eq(customers.segment, segment))

    const next = Number(row?.highest ?? 0) + 1 + attempt
    return `CUS-${segment.toUpperCase()}-${String(next).padStart(3, '0')}`
  }
}

