import { ClipboardList, Gauge, LayoutDashboard, Users, type LucideIcon } from 'lucide-react'
import type { Me } from '~/api/auth'
import type { DictKey } from '~/i18n'

/** The menu, declared once so the sidebar, the page title and the mobile bar
 *  all read the same list.
 *
 *  Every entry names the roles it belongs to, which is how three tiers share
 *  one shell without a chain of conditions per screen. This is presentation
 *  only — hiding a link is a courtesy, not a control. The server refuses the
 *  request either way, and scoping decides what comes back. */
export type NavItem = {
  key: DictKey
  to: string
  icon: LucideIcon
  roles: ReadonlyArray<Me['role']>
}

export const NAV: NavItem[] = [
  {
    key: 'nav.today',
    to: '/',
    icon: ClipboardList,
    roles: ['sale', 'team_lead', 'bm', 'admin'],
  },
  {
    key: 'nav.customers',
    to: '/customers',
    icon: Users,
    roles: ['sale', 'team_lead', 'bm', 'admin'],
  },
  {
    key: 'nav.opportunities',
    to: '/opportunities',
    icon: Gauge,
    roles: ['sale', 'team_lead', 'bm', 'admin'],
  },
  {
    /** One screen for the two roles that read rather than work: a team lead
     *  chasing their people and a branch manager reading the unit. They ask
     *  different questions of the same figures, which is a difference in what
     *  the rows are grouped by, not a reason for two screens. */
    key: 'nav.dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    roles: ['team_lead', 'bm'],
  },
]

export function navFor(role: Me['role']): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role))
}
