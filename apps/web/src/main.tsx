import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ApiError } from './api/client'
import { routeTree } from './routeTree.gen'
import './styles/app.css'

/** A session the server has ended, noticed wherever it first shows up.
 *
 *  The route guard trusts a cached answer for a minute (see
 *  `authStatusQuery`), so this is what keeps that honest: any request that
 *  comes back 401, and any background check of the session that comes back
 *  with nobody, drops everything cached for the old session and goes to the
 *  login. Every screen fetches on open, so the first request after the session
 *  ends is the one that catches it. */
function signedOut() {
  if (router.state.location.pathname === '/login') return
  queryClient.clear()
  void router.navigate({ to: '/login' })
}

const unauthorized = (error: unknown) => error instanceof ApiError && error.status === 401

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (unauthorized(error)) signedOut()
    },
    onSuccess: (data, query) => {
      const [scope, what] = query.queryKey as [unknown, unknown]
      if (scope === 'auth' && what === 'status' && (data as { user: unknown }).user === null) {
        signedOut()
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (unauthorized(error)) signedOut()
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      /** Retrying is for a flaky network, not for an answer. A 401, 403 or
       *  404 will say the same thing three more times, and the default retries
       *  with backoff made a screen wait seven seconds to show its error. */
      retry: (count, error) =>
        !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 2,
    },
  },
})

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: { queryClient },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
