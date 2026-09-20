import { queryOptions } from '@tanstack/react-query'
import { api } from './client'

/** The seven kinds of observation, straight from the two customer scenarios in
 *  the brief. `other` is the escape hatch, so nobody is ever blocked from
 *  recording something real because it does not fit a box. */
export const SIGNAL_TYPES = [
  'need',
  'competition',
  'deadline',
  'cash_flow',
  'product_gap',
  'documents',
  'other',
] as const

export type SignalType = (typeof SIGNAL_TYPES)[number]

export type Signal = {
  id: string
  customerId: string
  type: string
  content: string
  source: 'sale' | 'system' | 'ai'
  observedAt: string
  authorId: string | null
  /** Who wrote it, by name. Null where the system or the model did, and the
   *  timeline then shows the source alone rather than inventing an author. */
  authorName: string | null
  authorRole: string | null
  rawNote: string | null
  createdAt: string
}

export function signalsQuery(customerId: string) {
  return queryOptions({
    queryKey: ['customers', customerId, 'signals'],
    queryFn: () => api<Signal[]>(`/customers/${customerId}/signals`),
  })
}

export type NewSignal = {
  type: SignalType
  content: string
  rawNote?: string
  observedAt?: string
}

export function createSignal(customerId: string, body: NewSignal) {
  return api<Signal>(`/customers/${customerId}/signals`, { method: 'POST', body })
}
