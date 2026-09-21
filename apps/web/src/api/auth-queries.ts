import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { authStatus } from './auth'

/** The one source of truth for every route guard.
 *
 *  Cached for a minute and revalidated in the background, not fetched afresh
 *  on every navigation. The router re-runs the `/_app` guard on *every* page
 *  change, and with no cache each one waited on a round trip to the server —
 *  200–300 ms to the VPS — before it would leave the old page, so every click
 *  looked stuck. Hovering a link (preload on intent) fired another one.
 *
 *  What made the round trip feel necessary — a screen rendering for a session
 *  the server has already ended — is now caught where it actually shows up:
 *  every screen fetches data the moment it opens, and any 401 from any request
 *  clears the cache and sends the person to the login (see `main.tsx`). So is
 *  a background revalidation that comes back with no user. */
export const authStatusQuery = queryOptions({
  queryKey: ['auth', 'status'],
  queryFn: authStatus,
  staleTime: 60_000,
  retry: false,
})

/** Guards everything inside the app. */
export async function requireUser(queryClient: QueryClient) {
  const { user } = await queryClient.ensureQueryData({ ...authStatusQuery, revalidateIfStale: true })
  if (!user) throw redirect({ to: '/login' })
  return { user }
}

/** Guards the login screen, so someone already signed in cannot land back on
 *  it and wonder whether they were signed out. */
export async function requireGuest(queryClient: QueryClient) {
  const { user } = await queryClient.ensureQueryData({ ...authStatusQuery, revalidateIfStale: true })
  if (user) throw redirect({ to: '/' })
}
