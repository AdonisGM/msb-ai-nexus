import { queryOptions } from '@tanstack/react-query'
import { api } from './client'

/** How a customer's leads stand.
 *
 *  The four are disjoint and add up to `total`, which is the whole contract:
 *  the screen draws them as one stacked bar and one donut, so an overlap does
 *  not read as a small inaccuracy — the bar overflows and the percentages pass
 *  a hundred. `open` therefore means "live and somebody has rung it"; the ones
 *  nobody has rung are counted once, under `untouched`. */
export type LeadSummary = {
  total: number
  open: number
  won: number
  lost: number
  untouched: number
}

export type Customer = {
  id: string
  code: string
  name: string
  segment: 'sse' | 'rb'
  ownerId: string
  ownerName: string
  currentProducts: string[]
  revenue: number | null
  relationStage: string | null
  attributes: Record<string, unknown>
  contactName: string | null
  contactPhone: string | null
  note: string | null
  leads: LeadSummary
  /** When anything was last heard about them. Null means never, which is a
   *  louder version of the same worry rather than a missing value. */
  lastSignalAt: string | null
  createdAt: string
  updatedAt: string
}

export type CustomerPage = {
  rows: Customer[]
  /** Counted across everything the filter matched, not across the page. A
   *  donut that only knew about the rows on screen would change every time
   *  somebody paged. */
  summary: { revenue: number; leads: LeadSummary }
  total: number
  page: number
  pageSize: number
}

/** Which bucket a lead is in. Used by the filter chips, where the label has to
 *  read as "customers with at least one lead like this" — a chip saying
 *  "Hoàn thành 15" above nine rows is a support ticket. */
export type LeadBucket = 'untouched' | 'open' | 'won' | 'lost'

export type DateField = 'lastSignalAt' | 'createdAt' | 'updatedAt'

export type CustomerQuery = {
  q?: string
  segment?: string
  ownerId?: string
  relationStage?: string
  product?: string
  hasLead?: LeadBucket
  dateField?: DateField
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

/** Only sends the parameters that are set.
 *
 *  An empty `q=` is not the same request as no `q` — it changes the cache key
 *  and, on a server that takes the empty string literally, the results. */
function toSearch(query: CustomerQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `?${search}` : ''
}

export function customersQuery(query: CustomerQuery) {
  return queryOptions({
    queryKey: ['customers', query],
    queryFn: () => api<CustomerPage>(`/customers${toSearch(query)}`),
    /** Keeps the previous page on screen while the next one loads, so paging
     *  and typing in the search box do not blank the table on every keystroke. */
    placeholderData: (previous) => previous,
  })
}

/** The values behind the two free-text pickers.
 *
 *  Fetched rather than derived from the rows on screen: the list holds one
 *  page and the options live across all of them, so a dropdown built from the
 *  page would offer different choices on page two. */
export type Facets = { relationStages: string[]; products: string[] }

export function facetsQuery() {
  return queryOptions({
    queryKey: ['customers', 'facets'],
    queryFn: () => api<Facets>('/customers/facets'),
    /** They change when somebody edits a customer, which is rare, and a stale
     *  option costs nothing — the filter simply returns no rows. */
    staleTime: 5 * 60_000,
  })
}

export function customerQuery(id: string) {
  return queryOptions({
    queryKey: ['customers', 'detail', id],
    queryFn: () => api<Customer>(`/customers/${id}`),
  })
}

export type UpdateCustomerBody = {
  name?: string
  ownerId?: string
  currentProducts?: string[]
  revenue?: number
  relationStage?: string
  attributes?: Record<string, unknown>
  contactName?: string
  contactPhone?: string
  note?: string
}

/** `segment` is deliberately absent: moving a customer between segments would
 *  carry their whole book into the other team's numbers, so it is not
 *  something an edit form gets to do. The server refuses it too. */
export function updateCustomer(id: string, body: UpdateCustomerBody) {
  return api<Customer>(`/customers/${id}`, { method: 'PATCH', body })
}
