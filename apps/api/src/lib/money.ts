import Big from 'big.js'

/** Every money calculation in the project goes through this module.
 *
 *  JavaScript numbers are binary, so 0.1 + 0.2 is not 0.3 and a figure that
 *  should land exactly halfway can come out just under it and round the wrong
 *  way. One đồng of drift is invisible on a single deal and obvious once a
 *  branch total is compared against the sum of its parts — and those are the
 *  numbers the whole pitch rests on. big.js works in decimal, so it cannot
 *  happen.
 *
 *  Amounts are whole đồng: stored as bigint in Postgres, carried as `number`
 *  in TypeScript. Rates are basis points, 0 to 10000. */
Big.RM = Big.roundHalfUp
Big.DP = 6

/** Total deal size across a set of leads. */
export function pipelineValue(rows: { value: number }[]): number {
  return rows.reduce((total, row) => total + row.value, 0)
}

/** What is still missing against a target. Never negative: once the target is
 *  met the gap is closed, and a negative gap on screen reads as a bug. Use
 *  `surplus` for the amount over. */
export function gap(target: number, achieved: number): number {
  return Math.max(0, target - achieved)
}

export function surplus(target: number, achieved: number): number {
  return Math.max(0, achieved - target)
}

/** How many more wins it takes to reach a conversion target.
 *
 *  The branch's own GAP column, and the arithmetic behind every row of it:
 *  leads × rate, minus what has already landed.
 *
 *  The rounding is theirs, not ours, and it is not the obvious one. The
 *  shortfall is rounded once at the end rather than the requirement being
 *  rounded first: 1,801 leads at 6% needs 108.06, and against 35 wins their
 *  report prints 73, not the 74 that rounding 108.06 up to 109 would give.
 *  Matching a published column matters more here than picking the tidier
 *  rule — a figure that differs by one from the spreadsheet beside it is a
 *  figure nobody trusts, whichever of the two is defensible.
 *
 *  `rateBps` is basis points — 600 is 6% — so this stays in integers on the
 *  way in. A rate held as a float turns "did we hit six percent" into a
 *  question about rounding. */
export function dealsToTarget(leads: number, rateBps: number, won: number): number {
  if (leads <= 0 || rateBps <= 0) return 0
  const shortfall = new Big(leads).times(rateBps).div(10_000).minus(won)
  return Math.max(0, Number(shortfall.round(0)))
}

/** A conversion rate in basis points, so it can be compared against a target
 *  without either side being turned into a float. */
export function rateBps(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Number(new Big(part).times(10_000).div(whole).round(0))
}

/** Progress as a whole percent, for bars and headline figures. Returns 0 when
 *  no target is set, rather than dividing by zero and rendering NaN. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Number(new Big(part).times(100).div(whole).round(0))
}
