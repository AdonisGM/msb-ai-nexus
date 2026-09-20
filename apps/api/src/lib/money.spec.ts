import { describe, expect, it } from 'vitest'
import { dealsToTarget, gap, percentOf, pipelineValue, rateBps, surplus } from './money'

describe('gap and surplus', () => {
  it('reports what is still missing', () => {
    expect(gap(10_000_000_000, 3_000_000_000)).toBe(7_000_000_000)
  })

  /** A negative gap on screen reads as a bug, so the two directions are two
   *  functions rather than one that changes sign. */
  it('never goes negative once the target is met', () => {
    expect(gap(10_000_000_000, 12_000_000_000)).toBe(0)
    expect(surplus(10_000_000_000, 12_000_000_000)).toBe(2_000_000_000)
    expect(surplus(10_000_000_000, 3_000_000_000)).toBe(0)
  })
})

describe('the branch GAP column', () => {
  /** Checked against the branch's own report, which is where these numbers
   *  come from: 1,801 leads at 6% is 108 wins needed; 35 landed, so 73 to go.
   *  Hà Tĩnh is the other direction — 292 at 6% is 17.52, and 20 landed, so
   *  the gap is closed. */
  it('matches the figures the branch already publishes', () => {
    expect(dealsToTarget(1801, 600, 35)).toBe(73)
    expect(dealsToTarget(292, 600, 20)).toBe(0)
    expect(dealsToTarget(93, 600, 5)).toBe(1)
    expect(dealsToTarget(444, 600, 14)).toBe(13)
    expect(dealsToTarget(15_528, 600, 284)).toBe(648)
  })

  /** The shortfall is rounded once at the end, not the requirement first.
   *  Rounding 108.06 up to 109 before subtracting would print 74 where the
   *  branch prints 73 — off by one against a spreadsheet somebody is holding. */
  it('rounds the shortfall, not the requirement', () => {
    expect(dealsToTarget(1801, 600, 35)).toBe(73)
    expect(dealsToTarget(100, 600, 0)).toBe(6)
    expect(dealsToTarget(93, 600, 5)).toBe(1)
  })

  /** Past the target there is nothing left to go and get. The branch prints
   *  the overshoot in brackets; that is `surplus`, and a separate column. */
  it('stops at nothing once the target is passed', () => {
    expect(dealsToTarget(292, 600, 20)).toBe(0)
    expect(dealsToTarget(292, 600, 200)).toBe(0)
  })

  it('asks for nothing when there are no leads or no target', () => {
    expect(dealsToTarget(0, 600, 0)).toBe(0)
    expect(dealsToTarget(500, 0, 0)).toBe(0)
  })
})

describe('rateBps', () => {
  /** Basis points so a rate can be compared against a target without either
   *  side becoming a float. 284 of 15,528 is the branch's own 1.8%. */
  it('reports a rate the same way a target states it', () => {
    expect(rateBps(284, 15_528)).toBe(183)
    expect(rateBps(20, 292)).toBe(685)
    expect(rateBps(1, 1)).toBe(10_000)
  })

  it('returns zero instead of dividing by nothing', () => {
    expect(rateBps(5, 0)).toBe(0)
  })
})

describe('percentOf', () => {
  it('returns a whole percent', () => {
    expect(percentOf(7_600_000_000, 10_000_000_000)).toBe(76)
  })

  it('returns zero instead of NaN when no target is set', () => {
    expect(percentOf(5_000_000, 0)).toBe(0)
  })
})

describe('pipelineValue', () => {
  it('adds up what a set of leads is worth', () => {
    expect(pipelineValue([{ value: 2_000_000_000 }, { value: 500_000_000 }])).toBe(2_500_000_000)
  })
})
