import {
  BotMessageSquare,
  Gauge,
  LayoutDashboard,
  Users,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
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
  /** A short word beside the label, for a menu item that belongs to one role
   *  rather than to a tier. Only the admin's roster uses it so far. */
  hint?: string
}

export const NAV: NavItem[] = [
  {
    /** First, and first on purpose: a team lead opens the app to find out who
     *  needs chasing, and a branch manager to read the branch. Both are
     *  questions this screen answers before any list does.
     *
     *  One screen for the two roles, because they ask different questions of
     *  the same figures — a difference in what the rows are grouped by, not a
     *  reason for two screens. */
    key: 'nav.dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    roles: ['team_lead', 'bm'],
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
    /** Tia's own screen: every conversation, and one wide enough to read a
     *  table in. The floating panel stays for a quick question from any
     *  screen; this is for the longer ones. */
    key: 'nav.tia',
    to: '/tia',
    icon: BotMessageSquare,
    roles: ['sale', 'team_lead', 'bm', 'admin'],
  },
  {
    key: 'nav.users',
    to: '/users',
    icon: UserCog,
    roles: ['admin'],
    hint: 'Admin',
  },
]

export function navFor(role: Me['role']): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role))
}

/** Where this person lands when they sign in, or click the logo.
 *
 *  Their first menu item rather than a fixed path: the menu already says what
 *  each role is here to do, and a hard-coded home would send a salesperson to
 *  a screen the menu does not offer them. */
export function homeFor(role: Me['role']): string {
  return navFor(role)[0]?.to ?? '/customers'
}
