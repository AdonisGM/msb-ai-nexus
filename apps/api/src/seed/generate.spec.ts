import { describe, expect, it } from 'vitest'
import { BLOCKER_CODES, PRODUCTS } from '../db/schema'
import { ACTIONS } from '../opportunities/funnel'
import { daysBackToMonthStart, generateBranch } from './generate'
import { SALES_PROFILES } from './staff'

/** The bulk seed writes a thousand leads through the real services, so
 *  anything it generates that the funnel refuses fails halfway through a
 *  twenty-five second run with a stack trace and half a branch in the
 *  database. These check the shape before it gets that far.
 *
 *  They also pin the two properties the dataset exists for: it is the same
 *  branch on every run, and its conversion rate is the rate the profiles
 *  claim — a dashboard cannot be checked against figures that move. */

const branch = generateBranch()

describe('generateBranch', () => {
  it('makes the number of leads asked for', () => {
    expect(generateBranch({ deals: 200 }).deals).toHaveLength(200)
  })

  it('gives every salesperson a book and every lead an owner', () => {
    const owners = new Set(branch.deals.map((deal) => deal.ownerId))
    expect(owners).toEqual(new Set(SALES_PROFILES.map((profile) => profile.id)))
  })

  it('keeps each lead on a customer its own owner holds', () => {
    const byKey = new Map(branch.customers.map((customer) => [customer.key, customer]))

    for (const deal of branch.deals) {
      const customer = byKey.get(deal.customerKey)
      expect(customer, deal.customerKey).toBeDefined()
      /** A lead on somebody else's file is refused by the customer scope, and
       *  the seed dies on `customer_not_found` a thousand rows in. */
      expect(customer!.ownerId).toBe(deal.ownerId)
    }
  })

  it('names every customer once', () => {
    const names = branch.customers.map((customer) => customer.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is the same branch on every run', () => {
    expect(generateBranch({ deals: 120, seed: 7 })).toEqual(
      generateBranch({ deals: 120, seed: 7 }),
    )
  })

  it('is a different branch on a different seed', () => {
    const a = generateBranch({ deals: 120, seed: 7 })
    const b = generateBranch({ deals: 120, seed: 8 })
    expect(a.deals).not.toEqual(b.deals)
  })
})

describe('the funnel it describes', () => {
  it('only uses products and blockers the schema knows', () => {
    for (const deal of branch.deals) {
      expect(PRODUCTS).toContain(deal.product)
      if (deal.blockerCode) expect(BLOCKER_CODES).toContain(deal.blockerCode)
      for (const sold of deal.sold ?? []) expect(PRODUCTS).toContain(sold.product)
    }
  })

  it('never closes a lead nobody has contacted', () => {
    /** `win` and `lose` both start from a worked stage. A generated lead that
     *  is won straight out of `new` is a 409 in the middle of the seed. */
    const worked = ACTIONS.find((action) => action.action === 'win')!.from
    expect(worked).not.toContain('new')

    for (const deal of branch.deals) {
      if (deal.outcome) expect(deal.reach, deal.outcome).not.toBe('new')
    }
  })

  it('ties the marks to the stage it claims to have reached', () => {
    for (const deal of branch.deals) {
      expect(deal.contactedDaysAgo === undefined).toBe(deal.reach === 'new')
      expect(deal.advisedDaysAgo !== undefined).toBe(deal.reach === 'advised')
      expect(deal.closedDaysAgo !== undefined).toBe(deal.outcome !== undefined)
    }
  })

  it('walks its timeline forwards', () => {
    /** Days are counted back from today, so each step is a smaller number than
     *  the one before it. A step that goes the other way is a negative
     *  `heldMs` once the backdating runs. */
    for (const deal of branch.deals) {
      const steps = [
        deal.openedDaysAgo,
        deal.contactedDaysAgo,
        deal.advisedDaysAgo,
        deal.closedDaysAgo,
        deal.confirmedDaysAgo,
      ].filter((day): day is number => day !== undefined)

      for (let i = 1; i < steps.length; i++) {
        expect(steps[i], JSON.stringify(steps)).toBeLessThanOrEqual(steps[i - 1])
      }
      expect(Math.min(...steps)).toBeGreaterThanOrEqual(0)
    }
  })

  it('stays inside the window it was given', () => {
    const window = daysBackToMonthStart(12)
    for (const deal of branch.deals) {
      expect(deal.openedDaysAgo).toBeLessThanOrEqual(window)
    }
  })

  it('sells something on every win and names a blocker on every loss', () => {
    for (const deal of branch.deals) {
      if (deal.outcome === 'won') {
        /** The service refuses a win with nothing sold: the branch report
         *  counts cards and loans in separate columns, and a deal naming none
         *  of them lands in the total and in no column. */
        expect(deal.sold?.length, deal.need).toBeGreaterThan(0)
        expect(deal.outcomeReason).toBeTruthy()
      }
      if (deal.outcome === 'lost') {
        expect(deal.blockerCode).toBeTruthy()
        expect(deal.outcomeReason).toBeTruthy()
      }
      if (!deal.outcome) expect(deal.sold).toBeUndefined()
    }
  })

  it('only signs off leads that have closed', () => {
    for (const deal of branch.deals) {
      if (deal.confirmed) expect(deal.closedDaysAgo).toBeDefined()
    }
  })

  it('only puts a deadline on a live lead', () => {
    for (const deal of branch.deals) {
      expect(deal.dueInDays !== undefined).toBe(deal.outcome === undefined)
    }
  })
})

describe('the figures it is generated for', () => {
  it('hits each salesperson’s conversion rate exactly', () => {
    for (const profile of SALES_PROFILES) {
      const mine = branch.deals.filter((deal) => deal.ownerId === profile.id)
      const won = mine.filter((deal) => deal.outcome === 'won').length

      /** Exact, not approximate: the wins are allocated by count rather than
       *  rolled per lead, which is what keeps the branch's conversion rate
       *  the same in the month, the quarter and the year. */
      expect(won, profile.id).toBe(Math.round((mine.length * profile.crBps) / 10_000))
    }
  })

  it('spreads those wins across the whole window', () => {
    /** All in one quarter would make the monthly trend a single bar and every
     *  period but one read zero. */
    const wins = branch.deals.filter((deal) => deal.outcome === 'won')
    const recent = wins.filter((deal) => deal.openedDaysAgo <= 90).length

    expect(recent).toBeGreaterThan(0)
    expect(recent).toBeLessThan(wins.length)
  })

  it('leaves each of the team lead’s three queues something to chase', () => {
    const open = branch.deals.filter((deal) => deal.outcome === undefined)

    expect(open.filter((deal) => (deal.dueInDays ?? 0) < 0).length).toBeGreaterThan(20)
    expect(open.filter((deal) => deal.reach === 'new').length).toBeGreaterThan(20)
    expect(
      branch.deals.filter((deal) => deal.outcome && !deal.confirmed).length,
    ).toBeGreaterThan(10)
  })

  it('does not close everything, so the branch still has a book', () => {
    const open = branch.deals.filter((deal) => deal.outcome === undefined).length
    expect(open / branch.deals.length).toBeGreaterThan(0.2)
  })
})

describe('daysBackToMonthStart', () => {
  it('lands on the first of the month, so the trend opens on a whole bar', () => {
    const now = new Date(2026, 8, 20)
    /** Twelve months back from 20 September 2026 is 1 October 2025: 354 days,
     *  not 365. A flat year opens the oldest bar on the twentieth and draws a
     *  ten-day stub that reads as a branch that was shut. */
    expect(daysBackToMonthStart(12, now)).toBe(354)
  })

  it('counts one month as the days since this month began', () => {
    expect(daysBackToMonthStart(1, new Date(2026, 8, 20))).toBe(19)
  })

  it('crosses a year boundary', () => {
    expect(daysBackToMonthStart(3, new Date(2026, 1, 10))).toBe(71)
  })
})
