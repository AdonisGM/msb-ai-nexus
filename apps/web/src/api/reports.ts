import { queryOptions } from '@tanstack/react-query'
import { api } from './client'

/** Rates come back in basis points so they can be compared against a target
 *  without either side turning into a float. 600 is 6%. */
export const BPS = 10_000

export function pct(bps: number, digits = 0): string {
  return `${(bps / 100).toFixed(digits)}%`
}

export type FunnelStep = {
  step: 'contacted' | 'advised' | 'won'
  value: number
  /** How many were at the previous step, which is what `keptBps` is of. */
  of: number
  keptBps: number
  dropped: number
}

/** Where a lead stands, as one of five places it can be — not a funnel step.
 *  `new`, `contacted` and `advised` mean *still open at* that stage. */
export type LeadState = 'new' | 'contacted' | 'advised' | 'won' | 'lost'

export type Standing = { state: LeadState; value: number; shareBps: number }

export type Funnel = {
  leads: number
  contacted: number
  advised: number
  won: number
  lost: number
  crBps: number
  targetBps: number
  /** How many more wins it takes to reach the target. Zero once it is met. */
  gap: number
  steps: FunnelStep[]
  /** Measured, not assumed. Null on a branch with no leads at all. */
  weakestStep: FunnelStep['step'] | null
  /** The same leads split into parts that add up to `leads`, unlike the
   *  cumulative counts above. This is the one that can be drawn as shares. */
  standing: Standing[]
}

/** The counts every row of both dashboards is read through. */
export type Counts = {
  leads: number
  contacted: number
  advised: number
  won: number
  lost: number
  open: number
  overdue: number
  stale: number
  untouched: number
  crBps: number
  targetBps: number
  gap: number
}

export type OwnerRow = Counts & {
  ownerId: string
  ownerName: string
  customers: number
}

export type TeamRow = Counts & {
  leadId: string
  leadName: string
  segment: 'sse' | 'rb'
  heads: number
}

export type BreakdownRow = {
  key: string
  total: number
  won: number
  lost: number
  value: number
  shareBps: number
  /** Of what was decided, not of everything — a product with ten leads still
   *  being worked has no win rate yet, and counting them as losses would say
   *  it fails. */
  winBps: number
}

export type MonthRow = {
  /** `YYYY-MM`. */
  month: string
  /** Leads raised in this month — what the month was handed, and what its
   *  target is set against. */
  leads: number
  /** Decided in this month, whenever the lead itself was raised. */
  won: number
  lost: number
  /** Value of the wins, in đồng. */
  value: number
  targetBps: number
  /** The month's own intake at the branch's rate, in whole deals. */
  targetWon: number
  /** Wins against that target. Passes 10 000 when a month closed more than
   *  its own intake asked for, which is a real thing and not an error. */
  doneBps: number
}

export type ReportRange = { from?: string; to?: string; segment?: string; ownerId?: string }

function toSearch(range: ReportRange): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(range)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `?${search}` : ''
}

export function funnelQuery(range: ReportRange) {
  return queryOptions({
    queryKey: ['reports', 'funnel', range],
    queryFn: () => api<Funnel>(`/reports/funnel${toSearch(range)}`),
    placeholderData: (previous) => previous,
  })
}

export function byOwnerQuery(range: ReportRange) {
  return queryOptions({
    queryKey: ['reports', 'by-owner', range],
    queryFn: () => api<OwnerRow[]>(`/reports/by-owner${toSearch(range)}`),
    placeholderData: (previous) => previous,
  })
}

export function byTeamQuery(range: ReportRange) {
  return queryOptions({
    queryKey: ['reports', 'by-team', range],
    queryFn: () => api<TeamRow[]>(`/reports/by-team${toSearch(range)}`),
    placeholderData: (previous) => previous,
  })
}

export function breakdownQuery(by: 'product' | 'blocker' | 'segment', range: ReportRange) {
  return queryOptions({
    queryKey: ['reports', 'breakdown', by, range],
    queryFn: () => api<BreakdownRow[]>(`/reports/breakdown/${by}${toSearch(range)}`),
    placeholderData: (previous) => previous,
  })
}

export function monthlyQuery(range: ReportRange) {
  return queryOptions({
    queryKey: ['reports', 'monthly', range],
    queryFn: () => api<MonthRow[]>(`/reports/monthly${toSearch(range)}`),
    placeholderData: (previous) => previous,
  })
}

/** Where the period lands if it carries on as it has been going.
 *
 *  Two estimates rather than one, and both are wins per day: `fromRunRate` is
 *  this period's own pace over the whole period, `fromHistory` is the trailing
 *  year's pace over the days that are left. The screen shows the range between
 *  them, because the spread is the answer — they separate when the quarter is
 *  running hotter or colder than the year, which is the thing worth knowing.
 *
 *  `pipeline.worth` is a different question and is kept apart from the
 *  forecast on purpose: what the open book is worth *eventually*, weighted by
 *  each stage's measured win rate. A branch can be on pace and still be
 *  emptying its pipeline. */
export type Forecast = {
  period: { from: string; to: string; days: number; elapsed: number; remaining: number }
  landed: { won: number; lost: number; value: number }
  pipeline: {
    open: number
    value: number
    /** Wins the open book should eventually yield — not this period's. */
    worth: number
    stages: {
      stage: LeadState
      open: number
      winRateBps: number
      /** Median days a winning deal takes from this stage. Null when the
       *  branch has never won one from here. */
      medianDays: number | null
    }[]
  }
  expected: { fromRunRate: number; fromHistory: number; low: number; high: number }
  target: {
    crBps: number
    leadsToDate: number
    /** The intake projected on the same clock as the wins, so the forecast is
     *  not compared against a target for the fortnight that has happened. */
    leadsProjected: number
    wonToDate: number
    wonProjected: number
  }
  /** `today` is what is missing right now; `best` and `worst` are what would
   *  still be missing at the end of the period at each end of the range. */
  gap: { today: number; best: number; worst: number }
  /** How many closed deals the rates were measured from. Under twenty, the
   *  screen says so rather than drawing a confident line through noise. */
  basis: { closedDeals: number; months: number }
}

export function forecastQuery(range: ReportRange & { from: string; to: string }) {
  return queryOptions({
    queryKey: ['reports', 'forecast', range],
    queryFn: () => api<Forecast>(`/reports/forecast${toSearch(range)}`),
    placeholderData: (previous) => previous,
  })
}

export type AttentionReason = 'overdue' | 'stale' | 'untouched'

export type AttentionRow = {
  id: string
  code: string
  customerName: string
  ownerId: string
  ownerName: string
  segment: 'sse' | 'rb'
  product: string
  value: number
  stage: string
  dueDate: string | null
  blockerCode: string | null
  lastTouchAt: string
  /** Why this row is on the list, decided by the server rather than re-derived
   *  from dates against a clock in another timezone. */
  reasons: AttentionReason[]
}

/** The open leads worth a manager's own time.
 *
 *  `total` is everything that qualifies; `rows` is the handful shown, and
 *  `shownShareBps` says how much of the stuck value that handful covers — so
 *  the card can never imply it is showing all of the problem. */
export type Attention = {
  total: number
  value: number
  /** How much of the whole open book is in this state. */
  shareBps: number
  openTotal: number
  shownValue: number
  shownShareBps: number
  rows: AttentionRow[]
}

/** No date range: what is stuck is stuck now, whichever month raised it. */
export function attentionQuery(range: Omit<ReportRange, 'from' | 'to'> = {}) {
  return queryOptions({
    queryKey: ['reports', 'attention', range],
    queryFn: () => api<Attention>(`/reports/attention${toSearch(range)}`),
    placeholderData: (previous) => previous,
  })
}
