import {
  BadRequestException,
  ConflictException,
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
  isNull,
  max,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { customerScope, opportunityScope } from '../auth/scope'
import { DB, type Db } from '../db/db.module'
import {
  auditEvents,
  customers,
  opportunities,
  opportunityProducts,
  users,
  type AuditKind,
  type Opportunity,
  type Outcome,
  type Product,
  type Role,
  type Stage,
  type User,
} from '../db/schema'
import type { ActDto, CreateOpportunityDto, ListOpportunitiesDto, UpdateOpportunityDto } from './dto'
import {
  AUDIT_KIND_OF,
  actionsFor,
  findAction,
  fits,
  outcomeOf,
  permits,
  type ActionName,
  type LeadState,
  type Relation,
} from './funnel'

export const DEFAULT_PAGE_SIZE = 25

/** Fields worth recording a before/after for. The funnel marks are left out:
 *  the action already says what moved, and the timestamps beside it would bury
 *  the change someone actually made. */
const TRACKED = [
  'product',
  'need',
  'value',
  'dueDate',
  'blockerCode',
  'blockerNote',
  'nextAction',
  'missingInfo',
  'confirmedData',
  'ownerId',
] as const

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** When anything last happened to this lead.
 *
 *  Written once and used by the filter, the sort and the column the screen
 *  shows, because three copies of a `coalesce` is three chances for a list to
 *  disagree with the number printed on its own rows. The order matters: the
 *  advice is later than the call, and a lead nobody has touched falls back to
 *  the day it arrived, which is exactly how long it has been ignored. */
const LAST_TOUCH = sql`coalesce(${opportunities.advisedAt}, ${opportunities.contactedAt}, ${opportunities.createdAt})`

/** How a list is ordered, which is not a detail — it decides what the person
 *  looking at it does first.
 *
 *  `due` runs a salesperson's day. `stale` runs a team lead's chasing: the
 *  lead nobody has touched for longest, at the top, which is the one question
 *  their screen exists to answer. */
function orderFor(sort: string | undefined): SQL[] {
  switch (sort) {
    case 'stale':
      return [sql`${LAST_TOUCH} asc`]
    case 'value':
      return [sql`${opportunities.value} desc`]
    case 'recent':
      return [sql`${opportunities.updatedAt} desc`]
    default:
      /** Live leads first, then by deadline with nulls last.
       *
       *  The outcome key comes before the date because a list sorted on the
       *  date alone puts last month's closed deals above this week's open
       *  ones — and the top of this list is meant to be what to do next, not
       *  what has already been done. */
      return [
        sql`(${opportunities.outcome} = 'open') desc`,
        sql`${opportunities.dueDate} asc nulls last`,
        sql`${opportunities.updatedAt} desc`,
      ]
  }
}

@Injectable()
export class OpportunitiesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(user: User, query: ListOpportunitiesDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE

    const parts: (SQL | undefined)[] = [opportunityScope(this.db, user)]
    if (query.segment) parts.push(eq(opportunities.segment, query.segment))
    if (query.stage) parts.push(eq(opportunities.stage, query.stage))
    if (query.outcome) parts.push(eq(opportunities.outcome, query.outcome))
    if (query.product) parts.push(eq(opportunities.product, query.product))
    if (query.source) parts.push(eq(opportunities.source, query.source))
    if (query.blockerCode) parts.push(eq(opportunities.blockerCode, query.blockerCode))

    /** Over the lead and its customer together: somebody hunting for a lead
     *  remembers the customer's name long before they remember OPP-2026-0184.
     *  Accent-insensitive on both sides, like the customer search. */
    if (query.q) {
      const like = `%${query.q}%`
      parts.push(
        sql`(${opportunities.code} ilike ${like}
             or unaccent(${opportunities.need}) ilike unaccent(${like})
             or exists (
               select 1 from ${customers}
               where ${customers.id} = ${opportunities.customerId}
                 and (unaccent(${customers.name}) ilike unaccent(${like})
                      or ${customers.code} ilike ${like})
             ))`,
      )
    }
    if (query.ownerId) parts.push(eq(opportunities.ownerId, query.ownerId))
    if (query.customerId) parts.push(eq(opportunities.customerId, query.customerId))
    /** A salesperson's own working list. */
    if (query.mine) parts.push(eq(opportunities.ownerId, user.id))
    /** Nobody has called this yet — the row a team lead is looking for. */
    if (query.untouched) parts.push(isNull(opportunities.contactedAt))
    /** The signing queue: landed, nobody has checked it against the file. */
    if (query.awaitingConfirm) {
      parts.push(ne(opportunities.outcome, 'open'), isNull(opportunities.confirmedAt))
    }
    if (query.confirmed) parts.push(isNotNull(opportunities.confirmedAt))

    /** Past its date and still open. A lead that was closed late is not
     *  overdue, it is finished. */
    if (query.overdue) {
      parts.push(
        eq(opportunities.outcome, 'open'),
        sql`${opportunities.dueDate} is not null and ${opportunities.dueDate} < current_date`,
      )
    }

    /** Untouched for this many days, counted from the last thing that
     *  happened to it. This is the query a team lead's chasing is made of. */
    if (query.staleDays !== undefined) {
      parts.push(
        eq(opportunities.outcome, 'open'),
        sql`${LAST_TOUCH} < now() - make_interval(days => ${query.staleDays})`,
      )
    }

    const defined = parts.filter((part): part is SQL => part !== undefined)
    const where = defined.length > 0 ? and(...defined) : undefined

    const owner = alias(users, 'owner')
    const signer = alias(users, 'signer')
    const pending = alias(users, 'pending')

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(opportunities),
          /** The three names every screen needs and none of which a UUID can
           *  stand in for. Joined here rather than fetched per row: a list of
           *  twenty-five would otherwise be twenty-five requests to find out
           *  whose leads these are. */
          customerName: customers.name,
          customerCode: customers.code,
          ownerName: owner.name,
          confirmedByName: signer.name,
          /** Who the reconciliation is waiting on — the owner's own team lead.
           *
           *  Sent rather than left to the screen because the screen does not
           *  hold the roster: it would have to fetch the org chart to turn
           *  "đang chờ xác nhận" into "đang chờ Huy xác nhận", which is the
           *  difference between a status and a name to go and ask. */
          pendingConfirmName: pending.name,
          /** When anything last happened to this lead. Sent because the screen
           *  shows "9 ngày chưa liên hệ" and should not have to reproduce the
           *  coalesce that the sorting and the filter above both use.
           *
           *  `mapWith` matters more than it looks: a bare `sql` expression
           *  carries no type mapper, so this would come back as the driver's
           *  raw string while every other timestamp on the same row is a Date.
           *  One column of a different type than its neighbours is the kind of
           *  thing that is found in the browser, by a crash. */
          lastTouchAt: sql<Date>`${LAST_TOUCH}`.mapWith(opportunities.createdAt),
        })
        .from(opportunities)
        .innerJoin(customers, eq(customers.id, opportunities.customerId))
        .innerJoin(owner, eq(owner.id, opportunities.ownerId))
        .leftJoin(signer, eq(signer.id, opportunities.confirmedById))
        .leftJoin(pending, eq(pending.id, owner.managerId))
        .where(where)
        .orderBy(...orderFor(query.sort))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(opportunities).where(where),
    ])

    /** One roster lookup and one product lookup for the whole page rather than
     *  one of each per row. */
    const [relations, products] = await Promise.all([
      this.relationsFor(user, rows.map((row) => row.ownerId)),
      this.productsForMany(rows.filter((row) => row.outcome === 'won').map((row) => row.id)),
    ])

    return {
      rows: rows.map((row) => ({
        ...row,
        products: products.get(row.id) ?? [],
        /** Carried on every row, not just on a single fetch. The buttons sit
         *  in the expanded row, and asking the server per row for its own
         *  buttons is a request per row on a list built to open several. */
        actions: actionsFor(relations.get(row.ownerId)!, stateOf(row)),
      })),
      total,
      page,
      pageSize,
    }
  }

  /** One lead, plus the buttons this person may press on it.
   *
   *  The available actions come from the funnel table rather than the screen,
   *  so a rule added there reaches every screen at once and no button can be
   *  shown that the server would then refuse. */
  async get(user: User, id: string) {
    const [row] = await this.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), opportunityScope(this.db, user)))
      .limit(1)

    if (!row) throw new NotFoundException('opportunity_not_found')

    const [relation, products, names] = await Promise.all([
      this.relationTo(user, row.ownerId),
      this.productsOf(row.id),
      this.namesFor(row.id),
    ])

    return { ...row, ...names, products, actions: actionsFor(relation, stateOf(row)) }
  }

  async create(user: User, body: CreateOpportunityDto): Promise<Opportunity> {
    /** Read through the customer scope, so a lead cannot be attached to a file
     *  the caller is not allowed to see.
     *
     *  The owner's branch comes back with it: the lead is stamped with the
     *  branch that raised it, not with wherever that person sits by the time
     *  someone runs a report. */
    const [found] = await this.db
      .select({ customer: customers, unitId: users.unitId })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.ownerId))
      .where(and(eq(customers.id, body.customerId), customerScope(this.db, user)))
      .limit(1)

    if (!found) throw new NotFoundException('customer_not_found')
    const { customer, unitId } = found

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(opportunities)
        .values({
          id: randomUUID(),
          code: await this.nextCode(tx),
          customerId: customer.id,
          /** Copied from the customer: the funnel filters on it constantly,
           *  and a lead must never drift into the other segment's numbers. */
          segment: customer.segment,
          unitId,
          ownerId: customer.ownerId,
          product: body.product,
          need: body.need,
          value: body.value,
          /** Every lead starts untouched, however it arrived. Typing one in
           *  is not the same as having called it. */
          stage: 'new',
          source: body.source ?? 'manual',
          dueDate: body.dueDate ?? null,
          blockerCode: body.blockerCode ?? null,
          blockerNote: body.blockerNote ?? null,
          nextAction: body.nextAction ?? null,
          confirmedData: body.confirmedData ?? {},
          missingInfo: body.missingInfo ?? [],
          createdVia: 'manual',
        })
        .returning()

      await this.writeEvent(tx, {
        opportunityId: row.id,
        actorId: user.id,
        kind: 'created',
      })

      return row
    })
  }

  /** An edit in place. Records what changed, and never moves the funnel. */
  async update(user: User, id: string, body: UpdateOpportunityDto): Promise<Opportunity> {
    const before = await this.get(user, id)

    /** A landed deal is a reported figure. Editing its size after the fact
     *  would change a number someone has already acted on, so correcting one
     *  means reopening it first — which leaves a trace. */
    if (before.outcome !== 'open') throw new ConflictException('opportunity_is_closed')

    const patch: Record<string, unknown> = {}
    for (const field of TRACKED) {
      if (field === 'ownerId') continue
      const value = (body as Record<string, unknown>)[field]
      if (value !== undefined) patch[field] = value
    }

    if (Object.keys(patch).length === 0) return before

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(opportunities)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(opportunities.id, id))
        .returning()

      const changes = diff(before, row)
      if (Object.keys(changes).length > 0) {
        await this.writeEvent(tx, {
          opportunityId: id,
          actorId: user.id,
          kind: 'edited',
          changes,
          reason: body.reason ?? null,
        })
      }

      return row
    })
  }

  /** Presses a button.
   *
   *  Everything the move implies happens in one transaction: the stage, the
   *  funnel mark, the products sold, and the trail row. Splitting them is how
   *  a log ends up disagreeing with the record it describes. */
  async act(user: User, id: string, action: ActionName, body: ActDto = {}): Promise<Opportunity> {
    const before = await this.get(user, id)
    const state = stateOf(before)

    const rule = findAction(action)
    if (!rule) throw new BadRequestException('unknown_action')

    const relation = await this.relationTo(user, before.ownerId)

    /** Two different failures, kept apart because they mean different things
     *  to whoever hits them: this was never yours to press, versus the lead
     *  has moved on under you. */
    if (!permits(rule, relation)) throw new ForbiddenException('action_not_allowed_for_role')
    if (!fits(rule, state)) throw new ConflictException('action_not_allowed_from_state')

    if (rule.requiresReason && !body.reason?.trim()) {
      throw new BadRequestException('reason_required')
    }

    if (action === 'win' && (!body.products || body.products.length === 0)) {
      /** A win with nothing sold cannot be reported. The branch counts cards,
       *  overdrafts and loans in separate columns, and a deal that names none
       *  of them lands in the total and in no column. */
      throw new BadRequestException('products_required')
    }

    const next = outcomeOf(action, state)

    return this.db.transaction(async (tx) => {
      const now = new Date()
      const patch: Record<string, unknown> = {
        stage: next.stage,
        outcome: next.outcome,
        updatedAt: now,
      }

      if (body.nextAction !== undefined) patch.nextAction = body.nextAction
      if (body.dueDate !== undefined) patch.dueDate = body.dueDate
      if (body.missingInfo !== undefined) patch.missingInfo = body.missingInfo
      if (body.blockerCode !== undefined) patch.blockerCode = body.blockerCode
      if (body.blockerNote !== undefined) patch.blockerNote = body.blockerNote

      switch (action) {
        /** The funnel marks are written once. A lead called again next week is
         *  still a lead first called today, and overwriting the mark would
         *  quietly shrink every "how long until someone rang them" figure. */
        case 'contact':
          patch.contactedAt = before.contactedAt ?? now
          break

        case 'advise':
          patch.advisedAt = before.advisedAt ?? now
          break

        case 'win':
        case 'lose':
          patch.outcomeReason = body.reason
          patch.closedAt = now
          break

        case 'reopen':
          patch.outcomeReason = null
          patch.closedAt = null
          break

        case 'confirm':
          patch.confirmedById = user.id
          patch.confirmedAt = now
          patch.confirmNote = body.reason ?? null
          break
      }

      const [row] = await tx
        .update(opportunities)
        .set(patch)
        .where(eq(opportunities.id, id))
        .returning()

      if (action === 'win') await this.writeProducts(tx, id, body.products ?? [])
      /** A reopened lead has sold nothing until it lands again. Leaving the
       *  rows behind would keep it in the branch's product counts while its
       *  outcome says otherwise. */
      if (action === 'reopen') {
        await tx.delete(opportunityProducts).where(eq(opportunityProducts.opportunityId, id))
      }

      await this.writeEvent(tx, {
        opportunityId: id,
        actorId: user.id,
        kind: AUDIT_KIND_OF[action],
        changes: diff(before, row),
        reason: body.reason ?? null,
      })

      return row
    })
  }

  /** Hands a lead to someone else.
   *
   *  Separate from `act` because it is not a funnel move — the lead stays
   *  exactly where it was and only its owner changes. Admin only, which is the
   *  whole distribution story: a bulk upload names the salesperson by staff
   *  number, and whatever it could not match lands here to be placed by hand. */
  async assign(user: User, id: string, ownerId: string): Promise<Opportunity> {
    if (user.role !== 'admin') throw new ForbiddenException('action_not_allowed_for_role')

    const before = await this.get(user, id)

    const [taker] = await this.db
      .select({
        id: users.id,
        segment: users.segment,
        role: users.role,
        unitId: users.unitId,
        active: users.active,
      })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1)

    if (!taker) throw new NotFoundException('user_not_found')
    if (taker.role !== 'sale' && taker.role !== 'team_lead') {
      throw new BadRequestException('owner_must_be_in_the_sales_line')
    }
    if (!taker.active) throw new BadRequestException('owner_inactive')
    /** A retail lead in an SSE book would be counted under the wrong segment
     *  on every report that splits the two. */
    if (taker.segment !== before.segment) {
      throw new BadRequestException('owner_segment_mismatch')
    }
    /** Handing a lead across branches would leave it counted in one branch's
     *  report while being worked in another. Moving work between branches is
     *  not a reassignment; it would have to restate the figures on both sides,
     *  and nothing in this build does that. */
    if (taker.unitId !== before.unitId) {
      throw new BadRequestException('owner_in_another_unit')
    }
    if (before.ownerId === ownerId) return before

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(opportunities)
        .set({ ownerId, updatedAt: new Date() })
        .where(eq(opportunities.id, id))
        .returning()

      await this.writeEvent(tx, {
        opportunityId: id,
        actorId: user.id,
        kind: 'assigned',
        changes: { ownerId: [before.ownerId, ownerId] },
      })

      return row
    })
  }

  /** The full trace of one lead, oldest first — the data behind the timing
   *  figures and the history panel.
   *
   *  Names and roles come back with it rather than as bare ids. The screen
   *  shows who did each step and which tier they were acting from, and making
   *  it fetch the roster separately would mean one request per expanded row on
   *  a list where several can be open at once. */
  async history(user: User, id: string) {
    await this.get(user, id)

    const actor = alias(users, 'actor')

    return this.db
      .select({
        id: auditEvents.id,
        seq: auditEvents.seq,
        kind: auditEvents.kind,
        heldMs: auditEvents.heldMs,
        changes: auditEvents.changes,
        reason: auditEvents.reason,
        createdAt: auditEvents.createdAt,
        actorId: auditEvents.actorId,
        actorName: actor.name,
        actorRole: actor.role,
      })
      .from(auditEvents)
      .innerJoin(actor, eq(actor.id, auditEvents.actorId))
      .where(eq(auditEvents.opportunityId, id))
      .orderBy(asc(auditEvents.seq))
  }

  /** The three names a single lead is shown with, matching what the list
   *  already carries so the detail screen never says less than the row it was
   *  opened from. */
  private async namesFor(id: string) {
    const owner = alias(users, 'owner')
    const pending = alias(users, 'pending')
    const signer = alias(users, 'signer')

    const [found] = await this.db
      .select({
        customerName: customers.name,
        customerCode: customers.code,
        ownerName: owner.name,
        pendingConfirmName: pending.name,
        confirmedByName: signer.name,
      })
      .from(opportunities)
      .innerJoin(customers, eq(customers.id, opportunities.customerId))
      .innerJoin(owner, eq(owner.id, opportunities.ownerId))
      .leftJoin(pending, eq(pending.id, owner.managerId))
      .leftJoin(signer, eq(signer.id, opportunities.confirmedById))
      .where(eq(opportunities.id, id))
      .limit(1)

    return found ?? {
      customerName: '',
      customerCode: '',
      ownerName: '',
      pendingConfirmName: null,
      confirmedByName: null,
    }
  }

  private productsOf(opportunityId: string) {
    return this.db
      .select()
      .from(opportunityProducts)
      .where(eq(opportunityProducts.opportunityId, opportunityId))
      .orderBy(asc(opportunityProducts.product))
  }

  /** What a whole page of leads sold, in one query.
   *
   *  A won deal that does not say whether it was a card or an overdraft is a
   *  row the branch report can total but nobody can read. */
  private async productsForMany(ids: string[]) {
    const grouped = new Map<string, Array<typeof opportunityProducts.$inferSelect>>()
    if (ids.length === 0) return grouped

    const rows = await this.db
      .select()
      .from(opportunityProducts)
      .where(inArray(opportunityProducts.opportunityId, ids))
      .orderBy(asc(opportunityProducts.product))

    for (const row of rows) {
      const list = grouped.get(row.opportunityId)
      if (list) list.push(row)
      else grouped.set(row.opportunityId, [row])
    }

    return grouped
  }

  /** Replaces what a deal sold, rather than adding to it. Pressing "won" twice
   *  with a corrected list has to leave the corrected list, not both. */
  private async writeProducts(
    tx: Tx,
    opportunityId: string,
    sold: ReadonlyArray<{ product: string; amount: number; note?: string }>,
  ) {
    await tx.delete(opportunityProducts).where(eq(opportunityProducts.opportunityId, opportunityId))

    const seen = new Set<string>()
    const rows = sold
      .filter((item) => (seen.has(item.product) ? false : seen.add(item.product)))
      .map((item) => ({
        id: randomUUID(),
        opportunityId,
        product: item.product as Product,
        amount: item.amount,
        note: item.note ?? null,
      }))

    if (rows.length > 0) await tx.insert(opportunityProducts).values(rows)
  }

  /** Writes one row of the trace.
   *
   *  `seq` and `heldMs` are computed here rather than at read time because
   *  every timing figure depends on them, and a window function over the whole
   *  log on each render is the difference between a query and a report. */
  private async writeEvent(
    tx: Tx,
    input: {
      opportunityId: string
      actorId: string
      kind: AuditKind
      changes?: Record<string, unknown>
      reason?: string | null
    },
  ) {
    const [previous] = await tx
      .select({ seq: max(auditEvents.seq), at: max(auditEvents.createdAt) })
      .from(auditEvents)
      .where(eq(auditEvents.opportunityId, input.opportunityId))

    const seq = (previous?.seq ?? 0) + 1
    const heldMs = previous?.at ? Date.now() - previous.at.getTime() : null

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      opportunityId: input.opportunityId,
      seq,
      actorId: input.actorId,
      kind: input.kind,
      /** The schema ties "first event" to "nothing to measure from", so the
       *  first row reports no wait whatever the clock says. */
      heldMs: seq === 1 ? null : Math.max(0, heldMs ?? 0),
      changes: input.changes ?? {},
      reason: input.reason ?? null,
    })
  }

  /** Where this person stands relative to one lead's owner. */
  private async relationTo(user: User, ownerId: string): Promise<Relation> {
    const relations = await this.relationsFor(user, [ownerId])
    return relations.get(ownerId)!
  }

  /** The same question for a whole page of leads, in one query. */
  private async relationsFor(user: User, ownerIds: string[]): Promise<Map<string, Relation>> {
    const unique = [...new Set(ownerIds)]
    const relations = new Map<string, Relation>()
    if (unique.length === 0) return relations

    const owners = await this.db
      .select({ id: users.id, managerId: users.managerId })
      .from(users)
      .where(inArray(users.id, unique))

    const managerOf = new Map(owners.map((owner) => [owner.id, owner.managerId]))

    for (const ownerId of unique) {
      relations.set(ownerId, {
        role: user.role as Role,
        isOwner: ownerId === user.id,
        managesOwner: managerOf.get(ownerId) === user.id,
      })
    }

    return relations
  }

  /** OPP-2026-0001, numbered per year so the code says when it started. */
  private async nextCode(tx: Tx): Promise<string> {
    const year = new Date().getFullYear()
    const prefix = `OPP-${year}-`

    const [row] = await tx
      .select({
        highest: sql<number>`coalesce(max((substring(${opportunities.code} from '[0-9]+$'))::int), 0)`,
      })
      .from(opportunities)
      .where(sql`${opportunities.code} like ${prefix + '%'}`)

    return `${prefix}${String(Number(row?.highest ?? 0) + 1).padStart(4, '0')}`
  }
}

function stateOf(row: { stage: string; outcome: string; confirmedAt: Date | null }): LeadState {
  return {
    stage: row.stage as Stage,
    outcome: row.outcome as Outcome,
    confirmed: row.confirmedAt !== null,
  }
}

/** Before/after for the fields worth tracking, as `{ field: [was, now] }`.
 *
 *  Compared as JSON so arrays and objects — `missingInfo`, `confirmedData` —
 *  do not register a change every time they are rewritten with equal contents,
 *  which would fill the history with rows nobody made. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, [unknown, unknown]> = {}

  for (const field of TRACKED) {
    const was = before[field]
    const now = after[field]
    if (JSON.stringify(was ?? null) !== JSON.stringify(now ?? null)) {
      changes[field] = [was ?? null, now ?? null]
    }
  }

  return changes
}
