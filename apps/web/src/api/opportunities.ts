import { queryOptions } from '@tanstack/react-query'
import { api } from './client'

/** What MSB sells, as the branch report groups it. Closed, because the report
 *  is literally one column per product. */
export const PRODUCTS = ['card', 'od', 'usl', 'loan', 'casa', 'insurance', 'other'] as const
export type Product = (typeof PRODUCTS)[number]

/** The funnel. Three steps, and winning is not a fourth — it is `outcome`,
 *  and a lead can land straight off a first call without passing through
 *  `advised`. Keeping the two apart is what lets one screen say "42% đã tư
 *  vấn" and "11% thắng" about the same rows without the numbers arguing. */
export const STAGES = ['new', 'contacted', 'advised'] as const
export type Stage = (typeof STAGES)[number]

export type Outcome = 'open' | 'won' | 'lost'

export const BLOCKER_CODES = [
  'rate',
  'speed',
  'experience',
  'documents',
  'collateral',
  'policy',
  'competitor',
  'customer_hesitation',
  'other',
] as const

/** One product a deal actually sold. `amount` may be zero — a fee-free card
 *  is a real sale the branch counts — but never absent. */
export type SoldProduct = {
  id: string
  opportunityId: string
  product: Product
  amount: number
  note: string | null
}

export type Opportunity = {
  id: string
  code: string
  customerId: string
  segment: 'sse' | 'rb'
  unitId: string
  product: Product
  need: string
  value: number

  stage: Stage
  contactedAt: string | null
  advisedAt: string | null

  outcome: Outcome
  outcomeReason: string | null
  closedAt: string | null

  /** What a person has checked and stands behind, against what the model
   *  inferred and nobody has confirmed. Two fields, never one: the screen
   *  shows them in two colours, and merging them loses the answer to "how do
   *  you keep a human in control". */
  confirmedData: Record<string, unknown>
  aiHypothesis: Record<string, unknown>
  missingInfo: string[]

  blockerCode: string | null
  blockerNote: string | null
  nextAction: string | null
  dueDate: string | null

  ownerId: string
  source: 'import' | 'manual'
  createdVia: 'manual' | 'ai'

  /** The team lead's reconciliation. Changes no figure on any report — it
   *  records that a person checked this row against the file. */
  confirmedById: string | null
  confirmedAt: string | null
  confirmNote: string | null

  createdAt: string
  updatedAt: string

  /* Joined on the way out, because a UUID cannot be rendered. */
  customerName: string
  customerCode: string
  ownerName: string
  confirmedByName: string | null
  /** Who the signature is waiting on. "Đang chờ xác nhận" is a status;
   *  "Đang chờ Huy xác nhận" is a person to go and ask. */
  pendingConfirmName: string | null
  /** When anything last happened to it, for "9 ngày chưa liên hệ". */
  lastTouchAt: string

  products: SoldProduct[]
  actions: OfferedAction[]
}

/** What the signed-in person may press, and what each press needs.
 *
 *  Comes from the server because permission depends on whether this lead is
 *  theirs and whether they manage its owner — neither of which the screen
 *  knows. Working it out here means eventually offering a button the server
 *  refuses, and a 403 in front of somebody who did nothing wrong. */
export type ActionName = 'contact' | 'advise' | 'win' | 'lose' | 'confirm' | 'reopen'
export type OfferedAction = { action: ActionName; requiresReason: boolean }

export type OpportunityPage = {
  rows: Opportunity[]
  total: number
  page: number
  pageSize: number
}

export type OpportunityQuery = {
  q?: string
  blockerCode?: string
  customerId?: string
  segment?: string
  stage?: string
  outcome?: string
  product?: string
  source?: string
  ownerId?: string
  mine?: boolean
  untouched?: boolean
  awaitingConfirm?: boolean
  confirmed?: boolean
  overdue?: boolean
  staleDays?: number
  sort?: 'due' | 'stale' | 'value' | 'recent'
  page?: number
  pageSize?: number
}

function toSearch(query: OpportunityQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `?${search}` : ''
}

export function opportunitiesQuery(query: OpportunityQuery) {
  return queryOptions({
    queryKey: ['opportunities', query],
    queryFn: () => api<OpportunityPage>(`/opportunities${toSearch(query)}`),
    placeholderData: (previous) => previous,
  })
}

export type NewOpportunity = {
  customerId: string
  product: Product
  need: string
  value: number
  dueDate?: string
  blockerCode?: string
  blockerNote?: string
  nextAction?: string
  missingInfo?: string[]
}

export function opportunityQuery(id: string) {
  return queryOptions({
    queryKey: ['opportunities', 'detail', id],
    queryFn: () => api<Opportunity>(`/opportunities/${id}`),
  })
}

/** Everything that has happened to a lead, oldest first.
 *
 *  `heldMs` is how long it waited since the previous step, computed at write
 *  time. It is what turns a list of events into "bốn ngày mới có người gọi". */
export type HistoryEvent = {
  id: string
  seq: number
  kind:
    | 'created'
    | 'assigned'
    | 'contacted'
    | 'advised'
    | 'won'
    | 'lost'
    | 'reopened'
    | 'confirmed'
    | 'edited'
  heldMs: number | null
  changes: Record<string, [unknown, unknown]>
  reason: string | null
  createdAt: string
  actorId: string
  actorName: string
  actorRole: string
}

export function historyQuery(id: string) {
  return queryOptions({
    queryKey: ['opportunities', 'history', id],
    queryFn: () => api<HistoryEvent[]>(`/opportunities/${id}/history`),
  })
}

export function createOpportunity(body: NewOpportunity) {
  return api<Opportunity>('/opportunities', { method: 'POST', body })
}

/** An edit in place. Never the customer, the owner or the funnel: the first
 *  would move a lead into another segment's numbers, the second is a handover
 *  with its own endpoint, and the third is only ever the consequence of
 *  pressing a button.
 *
 *  Refused once the lead has landed. A closed deal is a figure somebody has
 *  already acted on, so correcting one means reopening it first — which leaves
 *  a trace. */
export type OpportunityPatch = {
  product?: Product
  need?: string
  value?: number
  dueDate?: string
  nextAction?: string
  blockerCode?: string
  blockerNote?: string
  missingInfo?: string[]
  /** Why the edit was made. Optional, and it lands in the trail beside the
   *  before and after. */
  reason?: string
}

export function updateOpportunity(id: string, body: OpportunityPatch) {
  return api<Opportunity>(`/opportunities/${id}`, { method: 'PATCH', body })
}

export type ActBody = {
  reason?: string
  /** Required on `win`, ignored everywhere else. A win that names no product
   *  lands in the branch total and in none of its columns. */
  products?: Array<{ product: Product; amount: number; note?: string }>
  nextAction?: string
  dueDate?: string
  blockerCode?: string
  blockerNote?: string
  missingInfo?: string[]
}

export function actOnOpportunity(id: string, action: ActionName, body: ActBody = {}) {
  return api<Opportunity>(`/opportunities/${id}/actions/${action}`, {
    method: 'POST',
    body,
  })
}
