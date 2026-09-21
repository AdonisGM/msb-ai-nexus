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

describe('where the leads stand', () => {
  /** The funnel counts nest — every won lead was also contacted — so they can
   *  never be drawn as shares of a whole. These five can. */
  it('splits every lead into exactly one place', async () => {
    const s = await scene()
    const report = await service.funnel(s.bm, {})

    const total = report.standing.reduce((sum, part) => sum + part.value, 0)
    expect(total).toBe(report.leads)
  })

  it('counts each state from the scene', async () => {
    const s = await scene()
    const { standing } = await service.funnel(s.bm, {})
    const at = (state: string) => standing.find((part) => part.state === state)?.value

    /** Four untouched, two contacted and open, two advised and open, one won,
     *  one lost. */
    expect(at('new')).toBe(4)
    expect(at('contacted')).toBe(2)
    expect(at('advised')).toBe(2)
    expect(at('won')).toBe(1)
    expect(at('lost')).toBe(1)
  })

  /** A closed lead belongs to its outcome and nowhere else, however far down
   *  the funnel it got before it closed. */
  it('keeps a closed lead out of the open states', async () => {
    const s = await scene()
    const { standing } = await service.funnel(s.bm, {})
    const open = standing
      .filter((part) => part.state !== 'won' && part.state !== 'lost')
      .reduce((sum, part) => sum + part.value, 0)

    expect(open).toBe(8)
  })

  it('reads each share against the total', async () => {
    const s = await scene()
    const { standing } = await service.funnel(s.bm, {})

    /** Four of ten. */
    expect(standing.find((part) => part.state === 'new')?.shareBps).toBe(4000)
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

  it('counts the losses beside the wins', async () => {
    const s = await scene()
    const rows = await service.monthly(s.bm, {})

    expect(rows[0].won).toBe(1)
    expect(rows[0].lost).toBe(1)
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
    const july = rows.find((row) => row.month === '2026-07')

    expect(july?.won).toBe(1)
    /** And the lead itself is counted in January, where it was raised: the
     *  month that was handed the work is not always the month that finished
     *  it, and the row says both. */
    expect(rows.find((row) => row.month === '2026-01')?.leads).toBe(1)
  })

  /** The month's own intake at the branch's rate — not a quarterly target cut
   *  into three, which would draw a line nobody agreed to. */
  it('sets each month a target from the leads that month was handed', async () => {
    const s = await scene()
    await makeTarget({ unitId: s.unit.id, metric: 'cr_rate', amount: 2000 })

    const [row] = await service.monthly(s.bm, {})

    expect(row.leads).toBe(10)
    /** Ten leads at 20% is two deals; one landed, so the month did half of
     *  what it was asked. */
    expect(row.targetWon).toBe(2)
    expect(row.doneBps).toBe(5000)
  })

  it('lets a month that closed more than it was handed pass a hundred percent', async () => {
    const s = await scene()
    await makeTarget({ unitId: s.unit.id, metric: 'cr_rate', amount: 600 })

    const [row] = await service.monthly(s.bm, {})

    /** Ten leads at 6% rounds to one deal, and one landed. */
    expect(row.targetWon).toBe(1)
    expect(row.doneBps).toBe(10_000)
  })

  /** Nothing was asked of a month that took no leads, so nothing is
   *  outstanding — and the line must not divide by zero on the way to saying
   *  so. */
  it('reads zero rather than infinity in a month with no intake', async () => {
    const s = await scene()
    const [won] = await testDb
      .select()
      .from(opportunities)
      .where(eq(opportunities.outcome, 'won'))

    await testDb
      .update(opportunities)
      .set({ closedAt: new Date('2026-07-11') })
      .where(eq(opportunities.id, won.id))

    const july = (await service.monthly(s.bm, {})).find((row) => row.month === '2026-07')

    expect(july?.leads).toBe(0)
    expect(july?.targetWon).toBe(0)
    expect(july?.doneBps).toBe(0)
  })
})

/* ─────────────────────────────── Dự báo ──────────────────────────────────── */

/** A day, as the report's range parameters spell it. */
function dayOffset(days: number): string {
  const now = new Date()
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + days))
  return day.toISOString().slice(0, 10)
}

const PERIOD = { from: dayOffset(-9), to: dayOffset(10) }

/** A quarter nine days old with twenty days in it, and a branch whose own
 *  history says three different things depending on how far a lead got.
 *
 *  Fifteen closed deals, laid out so the three conditional rates come out
 *  distinct and checkable by hand:
 *
 *  | reached    | closed | won | rate                |
 *  |------------|--------|-----|---------------------|
 *  | nothing    |      5 |   0 | 4/15 = 2667 bps *   |
 *  | contacted  |      5 |   1 | 4/10 = 4000 bps     |
 *  | advised    |      5 |   3 | 3/5  = 6000 bps     |
 *
 *  \* a lead nobody has contacted is measured against every closed deal,
 *  because that is where it is standing: the very beginning.
 *
 *  Every one of them was raised twenty days ago and closed five days ago, so
 *  the branch's median winning deal takes fifteen days. Eleven days are left
 *  in the period, which puts the due line at four days of age.
 *
 *  Fifteen still open, five at each stage: three raised eight days ago, which
 *  clears that line, and two raised yesterday, which does not. */
async function period() {
  const branch = await makeBranch()
  const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
  const at = (offset: number) => new Date(`${dayOffset(offset)}T00:00:00Z`)

  const add = (shape: Record<string, unknown>) =>
    makeOpportunity({ customerId: customer.id, ownerId: branch.saleRb.id, ...shape })

  const closed = [
    ...Array(5).fill({ stage: 'new', outcome: 'lost' }),
    { stage: 'contacted', outcome: 'won' },
    ...Array(4).fill({ stage: 'contacted', outcome: 'lost' }),
    ...Array(3).fill({ stage: 'advised', outcome: 'won' }),
    ...Array(2).fill({ stage: 'advised', outcome: 'lost' }),
  ]
  for (const shape of closed) {
    await add({ ...shape, createdAt: at(-20), closedAt: at(-5) })
  }

  for (const stage of ['new', 'contacted', 'advised']) {
    for (let i = 0; i < 3; i++) await add({ stage, createdAt: at(-8) })
    for (let i = 0; i < 2; i++) await add({ stage, createdAt: at(-1) })
  }

  await makeTarget({ unitId: branch.unit.id, metric: 'cr_rate', amount: 3000 })
  return { ...branch, customerId: customer.id }
}

describe('the end-of-period forecast', () => {
  /** A forecast of "all time" is not a forecast. */
  it('refuses to guess without a period', async () => {
    const s = await period()
    await expect(service.forecast(s.bm, { from: PERIOD.from })).rejects.toThrow()
    await expect(service.forecast(s.bm, {})).rejects.toThrow()
  })

  it('measures its rates off the branch’s own closed deals', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, PERIOD)

    expect(report.pipeline.stages).toEqual([
      { stage: 'new', open: 5, winRateBps: 2667, medianDays: 15 },
      { stage: 'contacted', open: 5, winRateBps: 4000, medianDays: 15 },
      { stage: 'advised', open: 5, winRateBps: 6000, medianDays: 15 },
    ])
    expect(report.basis.closedDeals).toBe(15)
  })

  /** The trailing year's pace over the eleven days that are left. Four wins
   *  in a year is a hair over a hundredth of a deal a day, so it expects
   *  nothing more to land — which, for a branch that has only ever closed
   *  four deals, is the honest answer. */
  it('reads the trailing year’s pace as the second estimate', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, PERIOD)

    expect(report.landed.won).toBe(4)
    expect(report.expected.fromHistory).toBe(4)
  })

  /** Both estimates are wins per day. Weighting the open pipeline by its win
   *  rates answers a different question — what the book is worth eventually —
   *  and that number is reported separately rather than mistaken for this
   *  period's: 5×0.2667 + 5×0.40 + 5×0.60 = 6.3 deals, whenever they land. */
  it('keeps what the open book is worth apart from what the period will do', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, PERIOD)

    expect(report.pipeline.open).toBe(15)
    expect(report.pipeline.worth).toBe(6)
    expect(report.pipeline.stages.map((stage) => stage.medianDays)).toEqual([15, 15, 15])
  })

  /** Four deals in nine days, over twenty days, is 8.9. */
  it('reads the clock as a second, independent estimate', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, PERIOD)

    expect(report.period).toMatchObject({ days: 20, elapsed: 9, remaining: 11 })
    expect(report.expected.fromRunRate).toBe(9)
  })

  /** The two disagree, and the range is the answer. Printing either one alone
   *  to the deal would be a confidence the data does not support. */
  it('reports the range rather than picking a winner', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, PERIOD)

    expect(report.expected.low).toBe(4)
    expect(report.expected.high).toBe(9)
  })

  /** The target moves as leads arrive, so it is projected on the same clock as
   *  the wins: 30 leads in nine days is 67 over twenty, and 30% of 67 is 20. */
  it('projects the target on the same clock as the wins', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, PERIOD)

    expect(report.target).toMatchObject({
      crBps: 3000,
      leadsToDate: 15,
      leadsProjected: 33,
      wonToDate: 5,
      wonProjected: 10,
    })
  })

  it('says what is missing now and what would still be missing at each end', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, PERIOD)

    expect(report.gap.today).toBe(1)
    expect(report.gap.best).toBe(1)
    expect(report.gap.worst).toBe(6)
  })

  /** A lead raised in August can close in September and counts towards
   *  September when it does — so the pipeline is every open lead, not only the
   *  ones the period itself raised. The target's intake is the opposite: that
   *  one belongs to the period that raised it. */
  it('counts open leads raised before the period, but not as intake', async () => {
    const s = await period()
    await makeOpportunity({
      customerId: s.customerId,
      ownerId: s.saleRb.id,
      stage: 'advised',
      createdAt: new Date(`${dayOffset(-40)}T00:00:00Z`),
    })

    const report = await service.forecast(s.bm, PERIOD)
    expect(report.pipeline.open).toBe(16)
    expect(report.target.leadsToDate).toBe(15)
  })

  /** Closed outside the period, so it is history for the rates and nothing for
   *  the result. */
  it('lands only what closed inside the period', async () => {
    const s = await period()
    await makeOpportunity({
      customerId: s.customerId,
      ownerId: s.saleRb.id,
      stage: 'advised',
      outcome: 'won',
      closedAt: new Date(`${dayOffset(-60)}T00:00:00Z`),
    })

    const report = await service.forecast(s.bm, PERIOD)
    expect(report.landed.won).toBe(4)
    expect(report.basis.closedDeals).toBe(16)
  })

  /** A rate from two restructures ago is not this branch's rate. */
  it('ignores history older than a year', async () => {
    const s = await period()
    await makeOpportunity({
      customerId: s.customerId,
      ownerId: s.saleRb.id,
      stage: 'advised',
      outcome: 'won',
      closedAt: new Date(`${dayOffset(-400)}T00:00:00Z`),
    })

    const report = await service.forecast(s.bm, PERIOD)
    expect(report.basis.closedDeals).toBe(15)
  })

  /** Nothing has elapsed, so there is no rate to stretch. The run-rate
   *  estimate falls back to what has landed rather than dividing by zero and
   *  rendering `Infinity` on a branch manager's screen. */
  it('survives a period that has not started', async () => {
    const s = await period()
    const report = await service.forecast(s.bm, { from: dayOffset(10), to: dayOffset(30) })

    expect(report.period.elapsed).toBe(0)
    expect(report.expected.fromRunRate).toBe(0)
    expect(report.target.leadsProjected).toBe(0)
    expect(Number.isFinite(report.expected.high)).toBe(true)
  })

  /** Scoped like every other read. A salesperson forecasts their own book; the
   *  colleague's leads are not in it. */
  it('forecasts only what the reader may see', async () => {
    const s = await period()
    const other = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    for (let i = 0; i < 20; i++) {
      await makeOpportunity({
        customerId: other.id,
        ownerId: s.saleSse.id,
        segment: 'sse',
        stage: 'advised',
      })
    }

    expect((await service.forecast(s.saleRb, PERIOD)).pipeline.open).toBe(15)
    expect((await service.forecast(s.bm, PERIOD)).pipeline.open).toBe(35)
  })
})

/* ────────────────────────── Cần BM can thiệp ─────────────────────────────── */

/** A branch with four open leads in different states, so every rule about what
 *  lands on a branch manager's list has something to fail against.
 *
 *  | lead    | value | state                          | on the list? |
 *  |---------|-------|--------------------------------|--------------|
 *  | huge    |  9 tỷ | silent 30 days                 | yes          |
 *  | late    |  5 tỷ | due yesterday, touched today   | yes          |
 *  | fresh   |  8 tỷ | raised today, nobody called    | no           |
 *  | working |  7 tỷ | advised yesterday              | no           | */
async function stuck() {
  const branch = await makeBranch()
  const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
  const at = (offset: number) => new Date(`${dayOffset(offset)}T00:00:00Z`)

  const add = (shape: Record<string, unknown>) =>
    makeOpportunity({ customerId: customer.id, ownerId: branch.saleRb.id, ...shape })

  await add({
    code: 'HUGE',
    value: 9_000_000_000,
    stage: 'contacted',
    createdAt: at(-30),
    contactedAt: at(-30),
  })
  await add({
    code: 'LATE',
    value: 5_000_000_000,
    stage: 'advised',
    dueDate: dayOffset(-1),
    advisedAt: at(0),
  })
  await add({ code: 'FRESH', value: 8_000_000_000, createdAt: at(0) })
  await add({ code: 'WORKING', value: 7_000_000_000, stage: 'advised', advisedAt: at(-1) })

  return { ...branch, customerId: customer.id }
}

describe('what needs a branch manager', () => {
  it('lists what is overdue or has gone silent, biggest first', async () => {
    const s = await stuck()
    const report = await service.attention(s.bm, {})

    expect(report.rows.map((row) => row.code)).toEqual(['HUGE', 'LATE'])
    expect(report.total).toBe(2)
    expect(report.value).toBe(14_000_000_000)
  })

  /** A list that opens with this morning's intake is a list a manager stops
   *  reading. Never-contacted only counts once it has also gone silent, which
   *  it does by itself — `LAST_TOUCH` falls back to the day it arrived. */
  it('leaves out a lead raised today that nobody has called yet', async () => {
    const s = await stuck()
    const report = await service.attention(s.bm, {})

    expect(report.rows.map((row) => row.code)).not.toContain('FRESH')
  })

  it('picks up that same lead once it has been sitting a week', async () => {
    const s = await stuck()
    const customer = await makeCustomer({ ownerId: s.saleRb.id, segment: 'rb' })
    await makeOpportunity({
      customerId: customer.id,
      ownerId: s.saleRb.id,
      code: 'IGNORED',
      value: 1_000_000_000,
      createdAt: new Date(`${dayOffset(-10)}T00:00:00Z`),
    })

    const report = await service.attention(s.bm, {})
    const row = report.rows.find((candidate) => candidate.code === 'IGNORED')
    expect(row?.reasons).toEqual(['stale', 'untouched'])
  })

  /** A branch manager has time for a handful a week, so the card shows a
   *  handful — and says how much of the problem that handful is. */
  it('says how much of the stuck value the rows it shows cover', async () => {
    const s = await stuck()
    const report = await service.attention(s.bm, {}, 1)

    expect(report.rows).toHaveLength(1)
    expect(report.total).toBe(2)
    expect(report.shownValue).toBe(9_000_000_000)
    /** Nine of fourteen billion. */
    expect(report.shownShareBps).toBe(6429)
  })

  it('reads the stuck value against the whole open book', async () => {
    const s = await stuck()
    const report = await service.attention(s.bm, {})

    expect(report.openTotal).toBe(4)
    /** 14 of 29 tỷ. */
    expect(report.shareBps).toBe(4828)
  })

  it('names the reason each row is there', async () => {
    const s = await stuck()
    const report = await service.attention(s.bm, {})
    const reasons = Object.fromEntries(report.rows.map((row) => [row.code, row.reasons]))

    expect(reasons.HUGE).toEqual(['stale'])
    expect(reasons.LATE).toEqual(['overdue'])
  })

  it('carries the customer and the person who owns the lead', async () => {
    const s = await stuck()
    const [row] = (await service.attention(s.bm, {})).rows

    expect(row.ownerName).toBe(s.saleRb.name)
    expect(row.customerName).toBeTruthy()
  })

  /** A closed lead is never overdue: once it is decided, the deadline stopped
   *  mattering. */
  it('drops a lead once it closes, however late it was', async () => {
    const s = await stuck()
    await testDb
      .update(opportunities)
      .set({ outcome: 'won', closedAt: new Date(), outcomeReason: 'Chốt muộn' })
      .where(eq(opportunities.code, 'LATE'))

    const report = await service.attention(s.bm, {})
    expect(report.rows.map((row) => row.code)).toEqual(['HUGE'])
  })

  it('shows a team lead only their own people', async () => {
    const s = await stuck()
    const other = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    await makeOpportunity({
      customerId: other.id,
      ownerId: s.saleSse.id,
      segment: 'sse',
      code: 'SSE-STUCK',
      value: 20_000_000_000,
      createdAt: new Date(`${dayOffset(-30)}T00:00:00Z`),
    })

    expect((await service.attention(s.bm, {})).total).toBe(3)
    expect((await service.attention(s.leadRb, {})).total).toBe(2)
    expect((await service.attention(s.leadSse, {})).rows.map((row) => row.code)).toEqual([
      'SSE-STUCK',
    ])
  })

  it('reports nothing rather than dividing by nothing on an empty branch', async () => {
    const branch = await makeBranch()
    const report = await service.attention(branch.bm, {})

    expect(report.rows).toEqual([])
    expect(report.shareBps).toBe(0)
    expect(report.shownShareBps).toBe(0)
  })
})
