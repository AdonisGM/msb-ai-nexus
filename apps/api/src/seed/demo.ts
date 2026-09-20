import { asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/db.module'
import { CustomersService } from '../customers/customers.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { SignalsService } from '../signals/signals.service'
import { TargetsService } from '../targets/targets.service'
import { auditEvents, opportunities, users, type User } from '../db/schema'
import { ACCOUNT_IDS } from './accounts'
import {
  CR_TARGETS,
  DEALS,
  PERIOD,
  RB_CUSTOMERS,
  SSE_CUSTOMERS,
  VALUE_TARGETS,
  type SeedCustomer,
  type SeedDeal,
} from './data'

const DAY = 24 * 60 * 60 * 1000

function daysFromNow(days: number) {
  return new Date(Date.now() + days * DAY)
}

function isoDate(days: number) {
  return daysFromNow(days).toISOString().slice(0, 10)
}

/** Wipes the demo data and builds it again.
 *
 *  Deals are replayed through the real services rather than written straight
 *  into the tables. It costs more than a bulk insert and it is the whole
 *  point: the audit trail, the send-backs, the handovers and the timings come
 *  out genuine, so opening the history of a deal during the demo shows a real
 *  trace instead of an empty panel. *//** Wipes the demo data and builds it again.
 *
 *  Leads are replayed through the real services rather than written straight
 *  into the tables. It costs more than a bulk insert and it is the whole
 *  point: the audit trail, the waiting times and the products sold come out
 *  genuine, so opening a lead's history during the demo shows a real trace
 *  instead of an empty panel. */
export async function seedDemo(db: Db) {
  const customersService = new CustomersService(db)
  const signalsService = new SignalsService(db)
  const opportunitiesService = new OpportunitiesService(db)
  const targetsService = new TargetsService(db)

  const actors = await loadActors(db)

  await db.execute(
    sql`truncate table audit_events, opportunity_products, opportunities, signals, customers, targets restart identity cascade`,
  )

  const customerIds = new Map<string, string>()

  for (const [segment, list, owner] of [
    ['sse', SSE_CUSTOMERS, actors.saleSse],
    ['rb', RB_CUSTOMERS, actors.saleRb],
  ] as const) {
    for (const seed of list as SeedCustomer[]) {
      const customer = await customersService.create(owner, {
        name: seed.name,
        segment,
        currentProducts: seed.currentProducts ?? [],
        revenue: seed.revenue,
        relationStage: seed.relationStage,
        attributes: seed.attributes ?? {},
        contactName: seed.contactName,
        contactPhone: seed.contactPhone,
        note: seed.note,
      })
      customerIds.set(seed.key, customer.id)

      for (const signal of seed.signals) {
        await signalsService.create(owner, customer.id, {
          type: signal.type,
          content: signal.content,
          observedAt: daysFromNow(-signal.daysAgo).toISOString(),
          rawNote: signal.rawNote,
        })
      }
    }
  }

  /** Every lead's timeline, keyed by id, so the backdating step does not have
   *  to work out from the trace what the table already said. */
  const timelines = new Map<string, SeedDeal>()

  for (const deal of DEALS) {
    const customerId = customerIds.get(deal.customer)
    if (!customerId) throw new Error(`Unknown customer key: ${deal.customer}`)

    const sse = SSE_CUSTOMERS.some((customer) => customer.key === deal.customer)
    const owner = sse ? actors.saleSse : actors.saleRb
    const lead = sse ? actors.leadSse : actors.leadRb

    const created = await opportunitiesService.create(owner, {
      customerId,
      product: deal.product,
      need: deal.need,
      value: deal.value,
      source: deal.source ?? 'import',
      dueDate: deal.dueInDays === undefined ? undefined : isoDate(deal.dueInDays),
      blockerCode: deal.blockerCode,
      blockerNote: deal.blockerNote,
      nextAction: deal.nextAction,
      missingInfo: deal.missingInfo,
    })

    timelines.set(created.id, deal)

    /** Walked one real action at a time, in the order a person would: the
     *  funnel table decides what is legal at each step, so a seed that
     *  contradicts the rules fails here rather than producing rows no screen
     *  can explain. */
    if (deal.reach !== 'new') {
      await opportunitiesService.act(owner, created.id, 'contact')
    }
    if (deal.reach === 'advised') {
      await opportunitiesService.act(owner, created.id, 'advise')
    }

    if (deal.outcome === 'won') {
      await opportunitiesService.act(owner, created.id, 'win', {
        reason: deal.outcomeReason,
        products: deal.sold,
      })
    } else if (deal.outcome === 'lost') {
      await opportunitiesService.act(owner, created.id, 'lose', {
        reason: deal.outcomeReason,
        blockerCode: deal.blockerCode,
        blockerNote: deal.blockerNote,
      })
    }

    /** The team lead reconciles it against the paperwork. Their own person's
     *  work, never their own — the service refuses the second. */
    if (deal.confirmed) {
      await opportunitiesService.act(lead, created.id, 'confirm', {
        reason: deal.confirmNote,
      })
    }
  }

  await seedTargets(targetsService, actors)
  await backdate(db, timelines)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opportunities)

  return {
    customers: SSE_CUSTOMERS.length + RB_CUSTOMERS.length,
    opportunities: Number(count),
  }
}

async function seedTargets(
  service: TargetsService,
  actors: Awaited<ReturnType<typeof loadActors>>,
) {
  /** The rate the branch is judged on, and the money number beside it. Both,
   *  because a conversion rate says nothing about whether the deals were
   *  worth having and a money total says nothing about how many leads were
   *  burned to get there. */
  const places = [
    { scope: 'unit' as const },
    { scope: 'unit' as const, segment: 'sse' as const },
    { scope: 'unit' as const, segment: 'rb' as const },
    { scope: 'user' as const, ownerId: actors.saleSse.id, key: 'saleSse' as const },
    { scope: 'user' as const, ownerId: actors.saleRb.id, key: 'saleRb' as const },
  ]

  for (const place of places) {
    const key = place.key ?? place.segment ?? 'unit'
    await service.set(actors.bm, {
      ...place,
      period: PERIOD,
      metric: 'cr_rate',
      amount: CR_TARGETS[key],
    })
    await service.set(actors.bm, {
      ...place,
      period: PERIOD,
      metric: 'value',
      amount: VALUE_TARGETS[key],
    })
  }
}

/** Moves every trace back onto the calendar the seed table describes.
 *
 *  Replaying a lead through the services takes milliseconds, so without this
 *  every step would be timed at a fraction of a second and "how long until
 *  somebody rang them" would be a column of zeroes. Real work takes days.
 *
 *  The times come from the seed table rather than from a random spread, so a
 *  lead that reads "opened 34 days ago, first called on day 31" is exactly
 *  that on screen — and `heldMs` is recomputed from the new timestamps, so the
 *  log and the row it describes can never disagree.
 *
 *  Only demo data is ever touched. */
async function backdate(db: Db, timelines: Map<string, SeedDeal>) {
  for (const [id, deal] of timelines) {
    const at: Partial<Record<string, Date>> = {
      created: daysFromNow(-deal.openedDaysAgo),
      contacted: when(deal.contactedDaysAgo),
      advised: when(deal.advisedDaysAgo),
      won: deal.outcome === 'won' ? when(deal.closedDaysAgo) : undefined,
      lost: deal.outcome === 'lost' ? when(deal.closedDaysAgo) : undefined,
      confirmed: when(deal.confirmedDaysAgo),
    }

    const trace = await db
      .select({ id: auditEvents.id, kind: auditEvents.kind })
      .from(auditEvents)
      .where(eq(auditEvents.opportunityId, id))
      .orderBy(asc(auditEvents.seq))

    let previous: number | null = null

    for (const event of trace) {
      const stamp = at[event.kind] ?? daysFromNow(-deal.openedDaysAgo)

      await db
        .update(auditEvents)
        .set({
          createdAt: stamp,
          /** Null on the first event and only there — the schema ties the two
           *  together, so a gap here would be refused rather than silently
           *  bending every duration drawn from this column. */
          heldMs: previous === null ? null : Math.max(0, stamp.getTime() - previous),
        })
        .where(eq(auditEvents.id, event.id))

      previous = stamp.getTime()
    }

    /** The lead's own marks move with its trace. Leaving them at replay time
     *  would put "first contacted" minutes ago on a lead whose log says it was
     *  three weeks back, and every figure drawn off the marks would disagree
     *  with every figure drawn off the log. */
    await db
      .update(opportunities)
      .set({
        createdAt: at.created!,
        contactedAt: at.contacted ?? null,
        advisedAt: at.advised ?? null,
        closedAt: at.won ?? at.lost ?? null,
        confirmedAt: at.confirmed ?? null,
        updatedAt: new Date(previous ?? at.created!.getTime()),
      })
      .where(eq(opportunities.id, id))
  }
}

function when(daysAgo: number | undefined): Date | undefined {
  return daysAgo === undefined ? undefined : daysFromNow(-daysAgo)
}

async function loadActors(db: Db) {
  const rows = await db.select().from(users)
  const byId = new Map(rows.map((row) => [row.id, row]))

  const pick = (id: string): User => {
    const found = byId.get(id)
    if (!found) throw new Error(`Missing account ${id}. Run the account seed first.`)
    return found
  }

  return {
    bm: pick(ACCOUNT_IDS.bm),
    leadSse: pick(ACCOUNT_IDS.leadSse),
    leadRb: pick(ACCOUNT_IDS.leadRb),
    saleSse: pick(ACCOUNT_IDS.saleSse),
    saleRb: pick(ACCOUNT_IDS.saleRb),
  }
}
