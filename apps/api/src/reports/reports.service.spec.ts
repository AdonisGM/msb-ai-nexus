import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, resetDb, testDb } from '../test/db'
import { makeBranch, makeCustomer, makeOpportunity, makeTarget } from '../test/factories'
import { opportunities } from '../db/schema'
import { eq } from 'drizzle-orm'
import { ReportsService } from './reports.service'

const service = new ReportsService(testDb)

beforeEach(resetDb)
afterAll(closeDb)

/** A branch with a known funnel, so every figure below can be checked by hand
 *  rather than against whatever the service happens to return.
 *
 *  Ten leads on Hải: four untouched, two contacted and open, two advised and
 *  open, one won, one lost. */
async function scene() {
  const branch = await makeBranch()
  const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })

  const shapes = [
    {}, {}, {}, {},
    { stage: 'contacted' as const },
    { stage: 'contacted' as const },
    { stage: 'advised' as const },
    { stage: 'advised' as const },
    { stage: 'advised' as const, outcome: 'won' as const },
    { stage: 'contacted' as const, outcome: 'lost' as const, blockerCode: 'rate' },
  ]
  for (const shape of shapes) {
    await makeOpportunity({ customerId: customer.id, ownerId: branch.saleRb.id, ...shape })
  }

  return { ...branch, customerId: customer.id }
}

describe('the funnel', () => {
  /** Counted from the marks, not from `stage`: a won lead stopped moving when
   *  it closed, but it was certainly contacted on the way. */
  it('counts every lead that ever reached a step, closed ones included', async () => {
    const s = await scene()
    const report = await service.funnel(s.bm, {})

    expect(report.leads).toBe(10)
    expect(report.contacted).toBe(6)
    expect(report.advised).toBe(3)
    expect(report.won).toBe(1)
    expect(report.lost).toBe(1)
  })

  /** 1 of 10 is 10%, against a 6% target — so nothing is owed. */
  it('reads the rate against the branch target and closes the gap', async () => {
    const s = await scene()
    await makeTarget({ unitId: s.unit.id, metric: 'cr_rate', amount: 600 })

    const report = await service.funnel(s.bm, {})
    expect(report.crBps).toBe(1000)
    expect(report.targetBps).toBe(600)
    expect(report.gap).toBe(0)
  })

  it('owes wins when the rate is under the target', async () => {
    const s = await scene()
    await makeTarget({ unitId: s.unit.id, metric: 'cr_rate', amount: 3000 })

    /** 10 leads at 30% needs 3; one landed, so two to go. */
    expect((await service.funnel(s.bm, {})).gap).toBe(2)
  })

  /** A gap column that silently read zero would say every branch is on
   *  target. */
  it('falls back to six percent when nobody has set a target', async () => {
    const s = await scene()
    expect((await service.funnel(s.bm, {})).targetBps).toBe(600)
  })

  /** Every step can be the leak. Naming one without checking sends somebody
   *  to fix the wrong thing. */
  it('measures which step loses the most rather than assuming', async () => {
    const s = await scene()
    const report = await service.funnel(s.bm, {})

    /** 6 of 10 contacted, 3 of 6 advised, 1 of 3 won — the last is thinnest. */
    expect(report.steps.map((step) => step.keptBps)).toEqual([6000, 5000, 3333])
    expect(report.weakestStep).toBe('won')
  })

  it('reports nothing rather than dividing by nothing on an empty branch', async () => {
    const branch = await makeBranch()
    const report = await service.funnel(branch.bm, {})

    expect(report.leads).toBe(0)
    expect(report.crBps).toBe(0)
    expect(report.gap).toBe(0)
    expect(report.weakestStep).toBeNull()
  })

  /** The scope is the only difference between a team lead's report and the
   *  branch manager's — the query is the same one. */
  it('shows a team lead only their own people', async () => {
    const s = await scene()
    const sseCustomer = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    await makeOpportunity({ customerId: sseCustomer.id, ownerId: s.saleSse.id, segment: 'sse' })

    expect((await service.funnel(s.bm, {})).leads).toBe(11)
    expect((await service.funnel(s.leadRb, {})).leads).toBe(10)
    expect((await service.funnel(s.leadSse, {})).leads).toBe(1)
  })

  it('narrows to a segment and to a window', async () => {
    const s = await scene()
    expect((await service.funnel(s.bm, { segment: 'sse' })).leads).toBe(0)
    expect((await service.funnel(s.bm, { segment: 'rb' })).leads).toBe(10)
    expect((await service.funnel(s.bm, { to: '2020-01-01' })).leads).toBe(0)
  })
})

describe('by salesperson', () => {
  it('gives one row per person with the three queues a team lead chases', async () => {
    const s = await scene()
    const [row] = await service.byOwner(s.leadRb, {})

    expect(row.ownerName).toBe(s.saleRb.name)
    expect(row.leads).toBe(10)
    expect(row.open).toBe(8)
    expect(row.untouched).toBe(4)
    /** Nothing was given a deadline, so nothing is late. */
    expect(row.overdue).toBe(0)
    expect(row.customers).toBe(1)
  })

  /** Joining the customer book onto the leads would multiply every count by
   *  the size of that book. */
  it('counts the book without inflating the lead counts', async () => {
    const s = await scene()
    for (let i = 0; i < 3; i++) await makeCustomer({ ownerId: s.saleRb.id, segment: 'rb' })

    const [row] = await service.byOwner(s.leadRb, {})
    expect(row.customers).toBe(4)
    expect(row.leads).toBe(10)
  })

  it('carries each person’s own rate and gap', async () => {
    const s = await scene()
    await makeTarget({ unitId: s.unit.id, metric: 'cr_rate', amount: 2000 })

    const [row] = await service.byOwner(s.bm, {})
    expect(row.crBps).toBe(1000)
    expect(row.gap).toBe(1)
  })
})

describe('by team', () => {
  it('groups salespeople under the lead they report to', async () => {
    const s = await scene()
    const rows = await service.byTeam(s.bm, {})

    expect(rows).toHaveLength(1)
    expect(rows[0].leadName).toBe(s.leadRb.name)
    expect(rows[0].leads).toBe(10)
    expect(rows[0].heads).toBe(1)
  })

  /** A team lead's own book is their own, and their manager reads it as part
   *  of the branch either way. */
  it('counts a team lead’s own leads under themselves', async () => {
    const s = await scene()
    const own = await makeCustomer({ ownerId: s.leadRb.id, segment: 'rb' })
    await makeOpportunity({ customerId: own.id, ownerId: s.leadRb.id })

    const rows = await service.byTeam(s.bm, {})
    const mine = rows.find((row) => row.leadName === s.leadRb.name)!
    expect(mine.leads).toBe(11)
  })
})

describe('breakdowns', () => {
  it('groups by product, with a win rate over what was decided', async () => {
    const s = await scene()
    const rows = await service.breakdown(s.bm, {}, 'product')

    expect(rows[0].key).toBe('loan')
    expect(rows[0].total).toBe(10)
    /** One won, one lost: half of what was decided. */
    expect(rows[0].winBps).toBe(5000)
    expect(rows[0].shareBps).toBe(10_000)
  })

  /** A lead with no blocker is not a category. Counting it would make the
   *  biggest slice of the chart the one that says nothing. */
  it('leaves leads with no blocker out of the blocker chart', async () => {
    const s = await scene()
    const rows = await service.breakdown(s.bm, {}, 'blocker')

    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('rate')
    expect(rows[0].shareBps).toBe(10_000)
  })

  it('groups by segment', async () => {
    const s = await scene()
    const sseCustomer = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    await makeOpportunity({ customerId: sseCustomer.id, ownerId: s.saleSse.id, segment: 'sse' })

    const rows = await service.breakdown(s.bm, {}, 'segment')
    expect(rows.map((row) => row.key)).toEqual(['rb', 'sse'])
    expect(rows[0].total).toBe(10)
  })
})

describe('the monthly trend', () => {
  /** A chart padded out to twelve bars, eleven empty, says the branch
   *  collapsed rather than that the system is new. */
  it('returns only the months that have something in them', async () => {
    const s = await scene()
    const rows = await service.monthly(s.bm, {})

    expect(rows).toHaveLength(1)
    expect(rows[0].won).toBe(1)
  })

  /** Dated by when it closed: a deal landed in September belongs to
   *  September however long it took to get there. */
  it('dates a win by when it closed, not when it was raised', async () => {
    const s = await scene()
    const [won] = await testDb
      .select()
      .from(opportunities)
      .where(eq(opportunities.outcome, 'won'))

    await testDb
      .update(opportunities)
      .set({ createdAt: new Date('2026-01-05'), closedAt: new Date('2026-07-11') })
      .where(eq(opportunities.id, won.id))

    const rows = await service.monthly(s.bm, {})
    expect(rows[0].month).toBe('2026-07')
  })
})
