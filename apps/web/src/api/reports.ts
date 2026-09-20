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

export type MonthRow = { month: string; won: number; value: number }

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
