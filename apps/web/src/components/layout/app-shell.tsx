import { useState, type ReactNode } from 'react'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react'
import { logout, type Me } from '~/api/auth'
import { Button } from '~/components/ui/primitives'
import { APP_VERSION } from '~/lib/version'
import { t } from '~/i18n'
import { initials } from '~/lib/format'
import { BrandLockup } from './msb-logo'
import { navFor } from './nav-config'
import { useTheme } from './theme'

/** How wide the content is allowed to get.
 *
 *  The frame itself always fills the window — the sidebar sits against the
 *  left edge and the background runs to both — but a pipeline table stretched
 *  across a 27-inch monitor is unreadable, so only the content inside the main
 *  column is capped and centred. */
const CONTENT_MAX = 1600

/** The header is fixed in height because the sidebar has to start exactly
 *  below it and stay there while the page scrolls. Measuring it at runtime
 *  would mean a layout pass before either could be positioned. */
const HEADER_H = 52

/** The frame every screen inside the app sits in.
 *
 *  Written for this project rather than copied: the shell it grew from carried
 *  a music player, a command palette over eight domains and per-item counters
 *  for wallets and subscriptions. None of that applies here.
 *
 *  Three tiers share one shell. What changes between them is the menu and the
 *  line under the name, which is the honest amount of difference — a team lead
 *  and a salesperson do the same kind of work on different rows. */
export function AppShell({ user, children }: { user: Me; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const items = navFor(user.role)

  return (
    <div className="relative flex min-h-screen flex-col bg-bg text-ink">
      {/** The same faint noise as the login screen. Without it the two read as
        *  different products the moment someone signs in. */}
      <div
        className="grain pointer-events-none fixed inset-0 z-0"
        style={{ opacity: 'var(--grain)' }}
      />

      <TopBar
        user={user}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
      />

      <div className="relative z-[1] flex min-h-0 flex-1">
        <aside className="hidden w-[232px] flex-none border-r border-line bg-surface lg:block">
          <div
            className="sticky flex flex-col"
            style={{ top: HEADER_H, height: `calc(100vh - ${HEADER_H}px)` }}
          >
            <Nav items={items} onNavigate={() => setMenuOpen(false)} />
            <Footprint />
          </div>
        </aside>

        {/** Under lg the same menu drops out of the bar instead. One list in
          *  two placements, rather than two components to keep in step. */}
        {menuOpen ? (
          <div
            className="fixed inset-x-0 bottom-0 z-30 overflow-y-auto border-b border-line bg-surface lg:hidden"
            style={{ top: HEADER_H }}
          >
            <Nav items={items} onNavigate={() => setMenuOpen(false)} />
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 pt-5 pb-14 sm:px-6 lg:px-8 lg:pt-7">
          <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: CONTENT_MAX }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

/** Sticky across the whole window, not just the content column.
 *
 *  The brand sits in a block exactly as wide as the sidebar with the same
 *  divider, so the two read as one edge rather than as a header that happens
 *  to overlap a column. Who is signed in and the way out stay reachable from
 *  every screen without scrolling back up — which matters in a demo where five
 *  people swap accounts between takes. */
function TopBar({
  user,
  menuOpen,
  onToggleMenu,
}: {
  user: Me
  menuOpen: boolean
  onToggleMenu: () => void
}) {
  return (
    <header
      className="sticky top-0 z-40 flex flex-none items-center border-b border-line bg-surface"
      style={{ height: HEADER_H }}
    >
      {/** Exactly the sidebar's width with the same divider, so the header and
        *  the column below it share one edge instead of two that nearly line
        *  up. */}
      <div className="flex h-full flex-none items-center gap-2.5 px-4 lg:w-[232px] lg:border-r lg:border-line">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          className="-ml-1 rounded-[6px] p-1 text-muted transition-colors hover:text-ink lg:hidden"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
        <Link to="/" className="flex items-center">
          <BrandLockup size="sm" />
        </Link>
      </div>

      <SectionTitle user={user} />

      <div className="ml-auto flex flex-none items-center gap-1 px-3">
        <ThemeToggle />
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Identity user={user} />
        <SignOut />
      </div>
    </header>
  )
}

/** Which screen this is, read off the same nav list the sidebar renders.
 *
 *  Matched by prefix so a customer's detail page still says "Khách hàng" — a
 *  header that goes blank on every second screen is worse than no header. */
function SectionTitle({ user }: { user: Me }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const current = navFor(user.role)
    .filter((item) => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)))
    .sort((a, b) => b.to.length - a.to.length)[0]

  if (!current) return null

  return (
    <div className="hidden min-w-0 items-center gap-2 px-5 md:flex">
      <current.icon size={15} className="flex-none text-muted" />
      <span className="truncate text-[13px] font-medium">{t(current.key)}</span>
    </div>
  )
}

function Nav({
  items,
  onNavigate,
}: {
  items: ReturnType<typeof navFor>
  onNavigate: () => void
}) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          /** Exact for the root, prefix for the rest: otherwise "Việc hôm nay"
           *  stays lit on every screen, and a highlighted menu that never
           *  changes is worse than none. */
          activeOptions={{ exact: item.to === '/' }}
          activeProps={{ className: 'bg-sunken text-ink' }}
          inactiveProps={{ className: 'text-muted hover:bg-sunken hover:text-ink' }}
          className="flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] transition-colors"
        >
          <item.icon size={16} className="shrink-0" />
          <span className="flex-1 truncate">{t(item.key)}</span>
          {item.hint ? (
            <span className="flex-none font-mono text-[10px] text-muted">{item.hint}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

/** Which build is running, at the foot of the column.
 *
 *  Baked into the image at build time rather than read from the server: it
 *  describes the bundle the browser is running, and a version fetched from
 *  the API would report the API's build while the screen showing it came from
 *  somewhere else entirely. In development it says `dev`, which is the honest
 *  answer to "which release is this".
 *
 *  Worth the two lines because the first question about any bug report is
 *  which build it came from, and the person reporting it is looking at this
 *  screen. */
function Footprint() {
  return (
    <div className="flex flex-none flex-col gap-0.5 border-t border-line px-3.5 py-3 text-[10.5px] text-muted">
      <span>© {new Date().getFullYear()} MSB AI Nexus</span>
      <span className="font-mono">Phiên bản {APP_VERSION}</span>
    </div>
  )
}

/** Who is signed in, said plainly.
 *
 *  Worth the space in a demo where five people swap accounts between takes:
 *  the fastest way to lose an audience is to act on the wrong screen and not
 *  notice. Role and segment both show, because "Hải" and "Hà" differ by
 *  segment, not by name. */
function Identity({ user }: { user: Me }) {
  return (
    <span className="flex items-center gap-2 pr-1 pl-1">
      <span className="grid size-7 flex-none place-items-center rounded-full bg-sunken text-[10.5px] font-semibold text-muted">
        {initials(user.name)}
      </span>
      <span className="hidden min-w-0 flex-col leading-tight sm:flex">
        <span className="truncate text-[12px] font-medium">{user.name}</span>
        <span className="truncate text-[10.5px] text-muted">
          {t(`role.${user.role}`)}
          {user.segment ? ` · ${t(`segment.${user.segment}.short`)}` : ''}
        </span>
      </span>
    </span>
  )
}

function ThemeToggle() {
  const { theme, setMode } = useTheme()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setMode(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
      title={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </Button>
  )
}

function SignOut() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      title={t('auth.signOut')}
      aria-label={t('auth.signOut')}
      onClick={async () => {
        setBusy(true)
        try {
          await logout()
        } finally {
          /** Clear the cache before navigating, or the guard on the next
           *  screen reads a remembered session and lets it through. */
          queryClient.clear()
          await router.navigate({ to: '/login' })
        }
      }}
    >
      <LogOut size={15} />
    </Button>
  )
}
