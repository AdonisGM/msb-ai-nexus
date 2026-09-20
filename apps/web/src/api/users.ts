import { queryOptions } from '@tanstack/react-query'
import { api } from './client'

/** The four roles. There is no fifth — a read-only account does not exist in
 *  the schema, and the branch manager is not optional. */
export const ROLES = ['admin', 'bm', 'team_lead', 'sale'] as const
export type Role = (typeof ROLES)[number]

export const SEGMENTS = ['sse', 'rb'] as const

/** Who each role answers to, mirrored from the service so the form can offer
 *  the right managers instead of letting somebody pick a wrong one and take a
 *  400 for it. The server still decides; this only keeps the screen honest. */
export const REPORTS_TO: Record<Role, Role | null> = {
  sale: 'team_lead',
  team_lead: 'bm',
  bm: null,
  admin: null,
}

export type UserRow = {
  id: string
  /** Login handle, `SALE-RB-01`. */
  code: string
  /** Staff number, `NV0006`. Two different things, and an upload of leads
   *  matches on the second. */
  employeeCode: string
  name: string
  email: string | null
  phone: string | null
  role: Role
  title: string
  level: string | null
  segment: 'sse' | 'rb' | null
  managerId: string | null
  managerName: string | null
  active: boolean
  /** Null on an account nobody has ever signed in to, which is exactly what
   *  an admin is looking for. */
  lastLoginAt: string | null
}

export type UserList = {
  rows: UserRow[]
  /** Counted across everybody, not across the filter: the figures describe
   *  the branch, not the search box. */
  summary: { total: number; active: number; locked: number; admins: number }
}

export type UserQuery = { q?: string; role?: string; active?: boolean }

function toSearch(query: UserQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `?${search}` : ''
}

export function usersQuery(query: UserQuery) {
  return queryOptions({
    queryKey: ['users', query],
    queryFn: () => api<UserList>(`/users${toSearch(query)}`),
    placeholderData: (previous) => previous,
  })
}

export type NewUser = {
  code: string
  employeeCode: string
  name: string
  role: Role
  title: string
  password: string
  segment?: string
  managerId?: string
  email?: string
  phone?: string
}

export function createUser(body: NewUser) {
  return api<{ user: unknown }>('/users', { method: 'POST', body })
}

export type UserPatch = {
  code?: string
  employeeCode?: string
  name?: string
  role?: Role
  title?: string
  segment?: string | null
  managerId?: string | null
  email?: string | null
  phone?: string | null
  active?: boolean
}

export function updateUser(id: string, body: UserPatch) {
  return api<{ user: unknown }>(`/users/${id}`, { method: 'PATCH', body })
}

/** Hands somebody a new password and signs them out everywhere. Returns
 *  nothing: the password came from the caller, and echoing it back only puts
 *  it somewhere else. */
export function setPassword(id: string, password: string) {
  return api<void>(`/users/${id}/password`, { method: 'POST', body: { password } })
}
