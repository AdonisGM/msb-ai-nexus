import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db/db.module'
import { CustomersService } from '../customers/customers.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { SignalsService } from '../signals/signals.service'
import { TargetsService } from '../targets/targets.service'
import { users, type User } from '../db/schema'
import { ACCOUNT_IDS } from './accounts'
import { CR_TARGETS, PERIOD, VALUE_TARGETS } from './data'
import { generateBranch, type GenerateOptions } from './generate'
import { backdate, daysFromNow, isoDate, type Timeline } from './replay'
import { SALES_PROFILES } from './staff'

/** A branch's year of work, at the volume the dashboard was built to read.
 *
 *  Same replay-through-the-services approach as `seedDemo`, for the same
 *  reason: the funnel table decides what is legal at each step, so data that
 *  contradicts the rules fails here rather than arriving on a screen that
 *  cannot explain it. The audit trail, the waiting times and the products sold
 *  all come out genuine.
 *
 *  It wipes the same tables `seedDemo` does, and it is the same choice: the two
 *  are alternatives, not layers. Run one or the other. */
export async function seedBulk(db: Db, options: Partial<GenerateOptions> = {}) {
  const customersService = new CustomersService(db)
  const signalsService = new SignalsService(db)
  const opportunitiesService = new OpportunitiesService(db)
  const targetsService = new TargetsService(db)

  const actors = await loadActors(db)
  const branch = generateBranch(options)

  await db.execute(
    sql`truncate table audit_events, opportunity_products, opportunities, signals, customers, targets restart identity cascade`,
  )

  const customerIds = new Map<string, string>()

  for (const customer of branch.customers) {
    const owner = actors.pick(customer.ownerId)

    const row = await customersService.create(owner, {
      name: customer.name,
      segment: customer.segment,
      currentProducts: customer.currentProducts,
      revenue: customer.revenue,
      relationStage: customer.relationStage,
      attributes: customer.attributes,
      contactName: customer.contactName,
      contactPhone: customer.contactPhone,
      note: customer.note,
    })

    customerIds.set(customer.key, row.id)

    for (const signal of customer.signals) {
      await signalsService.create(owner, row.id, {
        type: signal.type,
        content: signal.content,
        observedAt: daysFromNow(-signal.daysAgo).toISOString(),
      })
    }
  }

  const timelines = new Map<string, Timeline>()

  for (const deal of branch.deals) {
    const customerId = customerIds.get(deal.customerKey)
    if (!customerId) throw new Error(`Unknown customer key: ${deal.customerKey}`)

    const owner = actors.pick(deal.ownerId)
    /** Whoever signs this person's work off. The service refuses a team lead
     *  reconciling their own lead, so this must be the manager and never the
     *  owner — which it is, because every generated lead belongs to a
     *  salesperson. */
    const lead = actors.pick(owner.managerId!)

    const created = await opportunitiesService.create(owner, {
      customerId,
      product: deal.product,
      need: deal.need,
      value: deal.value,
      source: deal.source,
      dueDate: deal.dueInDays === undefined ? undefined : isoDate(deal.dueInDays),
      blockerCode: deal.blockerCode,
      blockerNote: deal.blockerNote,
      nextAction: deal.nextAction,
    })

    timelines.set(created.id, deal)

    if (deal.reach !== 'new') await opportunitiesService.act(owner, created.id, 'contact')
    if (deal.reach === 'advised') await opportunitiesService.act(owner, created.id, 'advise')

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

    if (deal.confirmed) {
      await opportunitiesService.act(lead, created.id, 'confirm', { reason: deal.confirmNote })
    }
  }

  await seedTargets(targetsService, actors.pick(ACCOUNT_IDS.bm))
  await backdate(db, timelines)

  return { customers: branch.customers.length, opportunities: branch.deals.length }
}

/** The branch's targets, and one per salesperson.
 *
 *  Only the unit-wide conversion target is read by the dashboard today — the
 *  per-person rows are there because the branch sets them, and a report that
 *  starts using them should find them already populated rather than find a
 *  seed that never wrote any. */
async function seedTargets(service: TargetsService, bm: User) {
  const places = [
    { scope: 'unit' as const, key: 'unit' as const },
    { scope: 'unit' as const, segment: 'sse' as const, key: 'sse' as const },
    { scope: 'unit' as const, segment: 'rb' as const, key: 'rb' as const },
  ]

  for (const { key, ...place } of places) {
    await service.set(bm, { ...place, period: PERIOD, metric: 'cr_rate', amount: CR_TARGETS[key] })
    await service.set(bm, { ...place, period: PERIOD, metric: 'value', amount: VALUE_TARGETS[key] })
  }

  for (const profile of SALES_PROFILES) {
    await service.set(bm, {
      scope: 'user',
      ownerId: profile.id,
      period: PERIOD,
      metric: 'cr_rate',
      /** The same 6% everyone else is measured against. Their own rate in
       *  `SALES_PROFILES` is what they actually achieve, which is a different
       *  thing and must not be written here — a target set to what somebody
       *  already does is not a target. */
      amount: CR_TARGETS.unit,
    })
  }
}

/** Every account in the branch, so a lead can be created as its owner and
 *  signed off as their manager without a lookup per row. */
async function loadActors(db: Db) {
  const rows = await db.select().from(users).where(eq(users.active, true))
  const byId = new Map(rows.map((row) => [row.id, row]))

  const missing = [ACCOUNT_IDS.bm, ...SALES_PROFILES.map((p) => p.id)].filter(
    (id) => !byId.has(id),
  )

  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.length} account(s): ${missing.join(', ')}. Run the account and staff seed first.`,
    )
  }

  return {
    pick(id: string): User {
      const found = byId.get(id)
      if (!found) throw new Error(`Missing account ${id}.`)
      return found
    },
  }
}
