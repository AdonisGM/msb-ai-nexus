import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import {
  BLOCKER_CODES,
  PRODUCTS,
  opportunitiesQuery,
  type Opportunity,
} from '~/api/opportunities'
import { Card, Chip, cx } from '~/components/ui/primitives'
import { ErrorState, Refreshing, ReloadButton, TableSkeleton } from '~/components/ui/query-state'
import { SearchInput, Toolbar } from '~/components/ui/toolbar'
import { t, tCode } from '~/i18n'
import { SEGMENT_TONE } from '~/lib/customer'
import { daysSince, daysUntil, dmDate } from '~/lib/dates'
import { useTableState } from '~/lib/table-state'
import { useDebounced } from '~/lib/use-debounced'

export const Route = createFileRoute('/_app/opportunities/')({ component: OpportunitiesScreen })

/** One grid for the header and every row, declared once so the two cannot
 *  drift apart. */
const COLS =
  'grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_118px_116px_132px_104px_30px]'

/** A live lead untouched for this long is what a team lead chases. Named
 *  rather than inlined so there is one place to change it when the branch
 *  says what the number should actually be — it is the design's, not a rule
 *  anybody has agreed. */
const COLD_DAYS = 14

type Filters = {
  q: string
  outcome: string
  product: string
  blockerCode: string
  overdue: boolean
}

const EMPTY: Filters = { q: '', outcome: '', product: '', blockerCode: '', overdue: false }

function OpportunitiesScreen() {
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()

  const table = useTableState<Filters>(EMPTY, 50)
  const q = useDebounced(table.filters.q)

  const query = useQuery(
    opportunitiesQuery({
      q: q || undefined,
      outcome: table.filters.outcome || undefined,
      product: table.filters.product || undefined,
      blockerCode: table.filters.blockerCode || undefined,
      overdue: table.filters.overdue || undefined,
      page: table.page,
      pageSize: table.size,
    }),
  )

  const filtered = Object.entries(table.filters).some(
    ([key, value]) => value !== EMPTY[key as keyof Filters],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">{t('nav.opportunities')}</h1>
          <p className="mt-1 text-[12.5px] text-muted">{scopeNote(user.role)}</p>
        </div>
        <ReloadButton busy={query.isFetching} onClick={() => void query.refetch()} />
      </div>

      <Card padded={false}>
        <Toolbar className="p-3.5">
          <SearchInput
            value={table.filters.q}
            onChange={(value) => table.set('q', value)}
            placeholder="Tìm mã cơ hội, nhu cầu, tên khách"
            className="min-w-[190px] flex-1"
          />
          <Picker
            value={table.filters.outcome}
            onChange={(value) => table.set('outcome', value)}
            blank="Mọi kết quả"
            options={(['open', 'won', 'lost'] as const).map((id) => ({
              value: id,
              label: t(`outcome.${id}`),
            }))}
          />
          <Picker
            value={table.filters.product}
            onChange={(value) => table.set('product', value)}
            blank="Mọi sản phẩm"
            options={PRODUCTS.map((id) => ({ value: id, label: t(`product.${id}`) }))}
          />
          <Picker
            value={table.filters.blockerCode}
            onChange={(value) => table.set('blockerCode', value)}
            blank="Mọi điểm vướng"
            options={BLOCKER_CODES.map((id) => ({ value: id, label: t(`blocker.${id}`) }))}
          />
          <button
            type="button"
            onClick={() => table.set('overdue', !table.filters.overdue)}
            className={cx(
              'h-8 cursor-pointer rounded-lg border px-2.5 text-[12px] transition-colors',
              table.filters.overdue
                ? 'border-accent bg-accent-soft font-semibold text-ink'
                : 'border-line2 text-muted hover:text-ink',
            )}
          >
            Quá hạn
          </button>
          {filtered ? (
            <button
              type="button"
              onClick={() => table.reset()}
              className="h-8 cursor-pointer text-[12px] text-muted underline decoration-line2 underline-offset-4 transition-colors hover:text-ink"
            >
              Bỏ lọc
            </button>
          ) : null}
        </Toolbar>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5 px-4 py-3">
          {/** "Cơ hội của tôi" only where it is true. A team lead sees their
            *  whole team here and a branch manager the whole unit, so the
            *  possessive is wrong for three of the four roles — and a title
            *  that lies about whose rows these are is worse than a plain one. */}
          <h2 className="text-[13.5px] font-semibold">{listTitle(user.role)}</h2>
          {query.data ? (
            <span className="text-[11.5px] text-muted">
              {query.data.rows.length} trên {query.data.total}{' '}
              {user.role === 'sale' ? 'cơ hội của tôi' : 'cơ hội'}
            </span>
          ) : null}
        </div>

        {query.isError ? (
          <div className="p-4 pt-0">
            <ErrorState
              what="danh sách cơ hội"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : query.isPending ? (
          <div className="p-4 pt-0">
            <TableSkeleton rows={8} />
          </div>
        ) : (
          <Refreshing busy={query.isFetching}>
            <div className="overflow-x-auto">
              <div className="min-w-[880px]">
                <div
                  className={cx(
                    'grid items-center gap-3 border-y border-line bg-sunken/40 px-4 py-2 text-[11px] text-muted',
                    COLS,
                  )}
                >
                  <span>Cơ hội</span>
                  <span>Khách hàng</span>
                  <span>Kết quả</span>
                  <span className="text-right">Im lặng</span>
                  <span>Điểm vướng</span>
                  <span className="text-right">Hạn</span>
                  <span />
                </div>

                {query.data.rows.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-4 py-[34px] text-center">
                    <span className="text-[13px]">Không có cơ hội nào khớp bộ lọc</span>
                    <span className="text-[12px] text-muted">
                      Bỏ bớt điều kiện để xem lại.
                    </span>
                  </div>
                ) : (
                  query.data.rows.map((deal) => (
                    <Row
                      key={deal.id}
                      deal={deal}
                      onOpen={() =>
                        void navigate({ to: '/opportunities/$id', params: { id: deal.id } })
                      }
                    />
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-line bg-raised px-4 py-2.5 text-[11px] text-muted">
              {/** The server sorts live leads first, then by deadline. Said out
                *  loud because a list whose order is not obvious reads as a
                *  list with no order. */}
              Sắp theo hạn việc tiếp theo, cơ hội đã chốt xuống cuối.
            </div>
          </Refreshing>
        )}
      </Card>
    </div>
  )
}

function Row({ deal, onOpen }: { deal: Opportunity; onOpen: () => void }) {
  const silent = daysSince(deal.lastTouchAt)
  const cold = deal.outcome === 'open' && silent !== null && silent >= COLD_DAYS
  const days = deal.dueDate ? daysUntil(deal.dueDate) : null
  const late = deal.outcome === 'open' && days !== null && days < 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cx(
        'grid cursor-pointer items-center gap-3 border-t border-line px-4 py-2.5 text-[12.5px] transition-colors hover:bg-sunken/50 focus:bg-sunken/50 focus:outline-none',
        COLS,
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium">{t(`product.${deal.product}`)}</span>
        <span className="font-mono text-[10.5px] text-muted">{deal.code}</span>
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{deal.customerName}</span>
          <Chip tone={SEGMENT_TONE[deal.segment]} className="flex-none">
            {t(`segment.${deal.segment}.short`)}
          </Chip>
        </span>
        <span className="font-mono text-[10.5px] text-muted">{deal.customerCode}</span>
      </span>

      <span>
        <Chip tone={OUTCOME_TONE[deal.outcome]}>{t(`outcome.${deal.outcome}`)}</Chip>
      </span>

      <span className={cx('text-right text-[11.5px]', cold ? 'text-danger' : 'text-muted')}>
        {silent === null ? 'chưa có' : silent === 0 ? 'hôm nay' : `${silent} ngày`}
      </span>

      <span className="truncate text-[11.5px]">
        {deal.blockerCode ? (
          tCode('blocker', deal.blockerCode)
        ) : (
          <span className="text-muted">không</span>
        )}
      </span>

      <span className={cx('text-right text-[11.5px]', late ? 'text-danger' : 'text-muted')}>
        {deal.dueDate ? `${late ? 'Quá hạn ' : ''}${dmDate(deal.dueDate)}` : 'chưa đặt'}
      </span>

      <ChevronRight size={15} className="justify-self-end text-muted" />
    </div>
  )
}

const OUTCOME_TONE = {
  open: { fg: 'var(--info)', bg: 'var(--info-soft)' },
  won: { fg: 'var(--success)', bg: 'var(--success-soft)' },
  lost: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
} as const

function Picker({
  value,
  onChange,
  options,
  blank,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  blank: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        'h-8 cursor-pointer rounded-lg border border-line2 bg-surface px-2 text-[12px] outline-none focus:border-accent',
        value ? 'text-ink' : 'text-muted',
      )}
    >
      <option value="">{blank}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function listTitle(role: string): string {
  return role === 'sale' ? 'Cơ hội của tôi' : t('nav.opportunities')
}

function scopeNote(role: string): string {
  switch (role) {
    case 'sale':
      return 'Cơ hội trong sổ của bạn.'
    case 'team_lead':
      return 'Cơ hội của nhóm bạn phụ trách.'
    case 'bm':
      return 'Toàn bộ cơ hội của đơn vị.'
    default:
      return 'Toàn bộ cơ hội.'
  }
}
