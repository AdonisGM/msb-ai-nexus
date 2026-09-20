import { createFileRoute, redirect } from '@tanstack/react-router'
import { homeFor } from '~/components/layout/nav-config'

/** Nobody stays here.
 *
 *  `/` is where signing in lands and where the logo points, but there is no
 *  screen behind it any more — the menu decides where each role starts, so
 *  this hands over to their first tab: the dashboard for a team lead or a
 *  branch manager, the customer list for everyone else.
 *
 *  Redirected in `beforeLoad` rather than from a component, so the browser
 *  never paints an empty page on the way through. */
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: homeFor(context.user.role), replace: true })
  },
})
