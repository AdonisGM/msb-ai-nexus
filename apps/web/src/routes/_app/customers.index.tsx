import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import {
  customersQuery,
  facetsQuery,
  type Customer,
  type CustomerQuery,
  type DateField,
  type LeadBucket,
} from '~/api/customers'
import { BUCKETS, LeadBar, LeadDonut } from '~/components/customer/lead-mix'
import { Card, Chip, Money, Mono, cx } from '~/components/ui/primitives'
import { Pager } from '~/components/ui/pager'
import { ErrorState, Refreshing, ReloadButton, TableSkeleton } from '~/components/ui/query-state'
import { SearchInput, Toolbar } from '~/components/ui/toolbar'
import { t } from '~/i18n'
import { SEGMENT_TONE } from '~/lib/customer'
import { daysSince } from '~/lib/dates'
import { fmtMoney, fmtNum } from '~/lib/format'
import { useTableState } from '~/lib/table-state'
import { useDebounced } from '~/lib/use-debounced'

export const Route = createFileRoute('/_app/customers/')({ component: CustomersScreen })

/** One grid, declared once, so the header cells and every row cell land on the
 *  same vertical lines. Two copies of this string is a table whose header
 *  drifts a pixel off its own columns. */
const COLS =
  'grid-cols-[minmax(0,1.7fr)_minmax(0,1.15fr)_minmax(0,1.25fr)_150px_128px_30px]'

type Filters = {
  q: string
  segment: string
  relationStage: string
  product: string
  hasLead: string
  dateField: DateField
  from: string
  to: string
}

const EMPTY: Filters = {
  q: '',
  segment: '',
  relationStage: '',
  product: '',
  hasLead: '',
  /** Both ends empty on purpose. A window that defaults to the last six weeks
   *  hides every quiet customer the moment the page opens — and the quiet ones
   *  are what this screen is for. */
  dateField: 'lastSignalAt',
  from: '',
  to: '',
}

const DATE_FIELDS: Array<{ value: DateField; label: string }> = [
  { value: 'lastSignalAt', label: 'Tín hiệu cuối' },
  { value: 'createdAt', label: 'Ngày tạo' },
  { value: 'updatedAt', label: 'Ngày cập nhật' },
]

function CustomersScreen() {
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()

  const table = useTableState<Filters>(EMPTY, 25)
  /** The box updates instantly, the request waits for a pause. */
  const q = useDebounced(table.filters.q)

  const query = useQuery(
    customersQuery({
      ...asQuery(table.filters),
      q: q || undefined,
      page: table.page,
      pageSize: table.size,
    }),
  )
  const facets = useQuery(facetsQuery())

  const summary = query.data?.summary
  const filtered = Object.entries(table.filters).some(
    ([key, value]) => value !== EMPTY[key as keyof Filters],
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">{t('nav.customers')}</h1>
          {/** Who is looking decides what comes back, so the screen says so
            *  rather than leaving someone to wonder why a colleague's list is
            *  longer than theirs. */}
          <p className="mt-1 text-[12.5px] text-muted">{scopeNote(user.role)}</p>
        </div>
        <ReloadButton busy={query.isFetching} onClick={() => void query.refetch()} />
      </div>

      {/** Cards down the left, table on the right.
        *
        *  Stacked above the table they scroll away the moment anyone reads a
        *  row, and the figures exist precisely to be read against the rows
        *  they summarise. On one column they go back on top, because a 300px
        *  rail on a phone is a rail nobody can read. */}
      <div className="grid items-start gap-4 lg:grid-cols-[296px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-[68px]">
          <MixCard leads={summary?.leads} filtered={query.data?.total} />
          <CloseRateCard leads={summary?.leads} />
        </div>

        {/** `overflow-hidden` because the footer paints its own background:
          *  a square corner drawn over a rounded one shows through as a
          *  clipped edge, and the same goes for the first row on hover. */}
        <Card padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 p-4">
          <Toolbar>
            <SearchInput
              value={table.filters.q}
              onChange={(value) => table.set('q', value)}
              placeholder="Tìm mã, tên khách, người liên hệ, số điện thoại"
              className="min-w-[280px] flex-1"
            />
            {/** Only worth showing to someone who can see both. A salesperson
              *  covers one segment, so this would be two options where one
              *  always returns nothing. */}
            {user.segment === null ? (
              <Picker
                value={table.filters.segment}
                onChange={(value) => table.set('segment', value)}
                blank="Mọi phân khúc"
                options={[
                  { value: 'sse', label: t('segment.sse') },
                  { value: 'rb', label: t('segment.rb') },
                ]}
              />
            ) : null}
            <Picker
              value={table.filters.product}
              onChange={(value) => table.set('product', value)}
              blank="Mọi sản phẩm"
              options={(facets.data?.products ?? []).map((value) => ({ value, label: value }))}
            />
            <Picker
              value={table.filters.relationStage}
              onChange={(value) => table.set('relationStage', value)}
              blank="Mọi giai đoạn"
              options={(facets.data?.relationStages ?? []).map((value) => ({
                value,
                label: value,
              }))}
            />
            {/** Narrows to customers holding at least one lead in that state —
              *  not to the leads themselves. The blank option says so, because
              *  the four below it cannot: this list picks rows out of a table
              *  of customers, and a reader who takes "Hoàn thành" for a count
              *  of deals will find the row count disagrees with it. */}
            <Picker
              value={table.filters.hasLead}
              onChange={(value) => table.set('hasLead', value)}
              blank="Mọi tình trạng cơ hội"
              options={BUCKETS.map((bucket) => ({ value: bucket.id, label: bucket.label }))}
            />
          </Toolbar>

          <Toolbar>
            <span className="flex items-center gap-2">
              <Picker
                value={table.filters.dateField}
                onChange={(value) => table.set('dateField', (value || 'lastSignalAt') as DateField)}
                options={DATE_FIELDS}
              />
              <DateBox value={table.filters.from} onChange={(v) => table.set('from', v)} />
              <span className="text-[12px] text-muted">→</span>
              <DateBox value={table.filters.to} onChange={(v) => table.set('to', v)} />
              {filtered ? (
                <button
                  type="button"
                  onClick={() => table.reset()}
                  className="h-8 cursor-pointer rounded-lg border border-line2 px-2.5 text-[12px] text-muted transition-colors hover:text-ink"
                >
                  Bỏ lọc
                </button>
              ) : null}
            </span>
          </Toolbar>
        </div>

        {query.isError ? (
          <div className="p-4 pt-0">
            <ErrorState
              what="danh sách khách hàng"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : query.isPending ? (
          <div className="p-4 pt-0">
            <TableSkeleton rows={8} />
          </div>
        ) : (
          /** The previous page stays and only dims while the next one loads,
            *  so typing in the search box does not blank the table. */
          <Refreshing busy={query.isFetching}>
            <Head showOwner={user.role !== 'sale'} />
            {query.data.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-14 text-center">
                <span className="text-[13px]">Không có khách hàng nào khớp bộ lọc</span>
                <span className="text-[12px] text-muted">
                  Nới khoảng ngày hoặc bỏ bớt điều kiện.
                </span>
              </div>
            ) : (
              query.data.rows.map((row) => (
                <Row
                  key={row.id}
                  customer={row}
                  showOwner={user.role !== 'sale'}
                  onOpen={() =>
                    void navigate({ to: '/customers/$id', params: { id: row.id } })
                  }
                />
              ))
            )}

            {/** No wrapper: the pager draws its own rule and its own 16px
              *  gutter, and a second one around it gave the footer two hairlines
              *  and pushed its text 30px in while the first column sat at 14. */}
            <Pager
              page={table.page}
              size={table.size}
              total={query.data.total}
              unit="khách hàng"
              onPage={table.setPage}
              onSize={table.setSize}
              sizes={[10, 25, 50]}
            />
          </Refreshing>
        )}
        </Card>
      </div>

      {summary ? (
        <p className="px-1 text-[12px] text-muted">
          Bấm vào dòng để mở hồ sơ khách hàng. Tổng doanh thu{' '}
          <span className="num text-ink">{fmtMoney(summary.revenue)}</span> trên{' '}
          {fmtNum(query.data?.total ?? 0)} khách hàng đang lọc.
        </p>
      ) : null}
    </div>
  )
}

/** The mix of leads under whatever filter is applied.
 *
 *  Counts leads, while the table counts customers, and the subtitle says so —
 *  the two numbers are different on purpose and a reader who is not told will
 *  read the difference as a bug. */
function MixCard({ leads, filtered }: { leads?: LeadSummaryish; filtered?: number }) {
  const total = leads?.total ?? 0
  const donePct = total > 0 ? Math.round(((leads?.won ?? 0) / total) * 100) : 0

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium">Tình trạng cơ hội</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Đếm cơ hội của {fmtNum(filtered ?? 0)} khách hàng đang lọc
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center gap-4">
        <LeadDonut leads={leads ?? EMPTY_LEADS} size={148}>
          <span className="flex flex-col leading-none">
            <span className="num text-[20px] font-medium">{donePct}%</span>
            <span className="mt-1 text-[10.5px] text-muted">cơ hội thắng</span>
          </span>
        </LeadDonut>

        <div className="flex w-full min-w-0 flex-col gap-1.5">
          {BUCKETS.map((bucket) => {
            const count = leads?.[bucket.id] ?? 0
            return (
              <span key={bucket.id} className="flex items-center gap-2 text-[12px]">
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: bucket.color }}
                />
                <span className="min-w-0 flex-1 truncate text-muted">{bucket.label}</span>
                <span className="num font-medium">{count}</span>
                <span className="num w-9 text-right text-[11px] text-muted">
                  {total > 0 ? `${Math.round((count / total) * 100)}%` : '—'}
                </span>
              </span>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

/** Wins against everything that has actually been decided.
 *
 *  The denominator is won + lost rather than every lead, because a rate that
 *  counted leads still being worked would read as a failure on a healthy book
 *  and would climb by itself as old leads aged out. */
function CloseRateCard({ leads }: { leads?: LeadSummaryish }) {
  const won = leads?.won ?? 0
  const lost = leads?.lost ?? 0
  const decided = won + lost
  const pct = decided > 0 ? Math.round((won / decided) * 100) : 0

  return (
    <Card>
      <h2 className="text-[13px] font-medium">Tỷ lệ chốt</h2>
      <p className="mt-0.5 text-[11.5px] text-muted">Cơ hội thắng trên số đã xử lý</p>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="num text-[28px] leading-none font-medium">{pct}%</span>
        <span className="text-[12px] text-muted">
          {fmtNum(won)} trên {fmtNum(decided)} cơ hội đã xử lý
        </span>
      </div>

      <span className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <span style={{ width: `${pct}%`, background: 'var(--c-success)' }} />
      </span>

      <div className="mt-3 flex flex-col gap-1.5">
        {[
          { label: 'Cơ hội thắng', count: won, color: 'var(--c-success)' },
          { label: 'Cơ hội thua', count: lost, color: 'var(--c-danger)' },
        ].map((line) => (
          <span key={line.label} className="flex items-center gap-2 text-[12px]">
            <span className="size-2 flex-none rounded-full" style={{ background: line.color }} />
            <span className="min-w-0 flex-1 truncate text-muted">{line.label}</span>
            <span className="num font-medium">{fmtNum(line.count)}</span>
          </span>
        ))}
      </div>
    </Card>
  )
}

function Head({ showOwner }: { showOwner: boolean }) {
  return (
    <div
      className={cx(
        'grid items-center gap-3 border-y border-line bg-sunken/40 px-4 py-2 text-[11px] text-muted',
        COLS,
      )}
    >
      <span>Khách hàng</span>
      <span>{showOwner ? 'Phụ trách và liên hệ' : 'Người liên hệ'}</span>
      <span>Sản phẩm đang dùng</span>
      <span className="text-right">Doanh thu, đồng</span>
      <span>Cơ hội</span>
      <span />
    </div>
  )
}

function Row({
  customer,
  showOwner,
  onOpen,
}: {
  customer: Customer
  showOwner: boolean
  onOpen: () => void
}) {
  const silent = daysSince(customer.lastSignalAt)

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
        'grid cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 text-[12.5px] transition-colors last:border-b-0 hover:bg-sunken/50 focus:bg-sunken/50 focus:outline-none',
        COLS,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{customer.name}</span>
          <Chip tone={SEGMENT_TONE[customer.segment]} className="flex-none">
            {t(`segment.${customer.segment}.short`)}
          </Chip>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
          <Mono>{customer.code}</Mono>
          {customer.relationStage ? (
            <span className="truncate">{customer.relationStage}</span>
          ) : null}
        </span>
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        {showOwner ? (
          <span className="truncate text-[12px]">{customer.ownerName}</span>
        ) : null}
        <span className={cx('truncate', showOwner && 'text-[11px] text-muted')}>
          {customer.contactName ?? <span className="text-muted">Chưa có người liên hệ</span>}
        </span>
        {customer.contactPhone ? (
          <span className="num truncate text-[11px] text-muted">{customer.contactPhone}</span>
        ) : null}
      </span>

      <Products items={customer.currentProducts} />

      <span className="text-right">
        {customer.revenue === null ? (
          <span className="text-[11.5px] text-muted">chưa có</span>
        ) : (
          <Money value={fmtNum(customer.revenue)} />
        )}
      </span>

      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-baseline gap-2">
          <span className="num text-[12px] font-medium">{customer.leads.total}</span>
          <span className="text-[11px] text-muted">
            {silent === null
              ? 'chưa có tin'
              : silent === 0
                ? 'có tin hôm nay'
                : `${silent} ngày trước`}
          </span>
        </span>
        <LeadBar leads={customer.leads} />
      </span>

      <ChevronRight size={15} className="justify-self-end text-muted" />
    </div>
  )
}

/** Products in use, trimmed.
 *
 *  A customer on five products would push every other column off the screen,
 *  so two show and the rest become a count. The full list is on the detail
 *  screen, which is where someone goes when they actually care. */
function Products({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <span className="text-[11.5px] text-muted">Chưa dùng sản phẩm</span>
  }

  const shown = items.slice(0, 2)
  const rest = items.length - shown.length

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((item) => (
        <span
          key={item}
          className="truncate rounded-[4px] bg-sunken px-1.5 py-[2px] text-[11px] text-ink2"
        >
          {item}
        </span>
      ))}
      {rest > 0 ? <span className="flex-none text-[11px] text-muted">+{rest}</span> : null}
    </span>
  )
}

function Picker({
  value,
  onChange,
  options,
  blank,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  blank?: string
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
      {blank ? <option value="">{blank}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function DateBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        'h-8 rounded-lg border border-line2 bg-surface px-2 font-mono text-[12px] outline-none focus:border-accent',
        value ? 'text-ink' : 'text-muted',
      )}
    />
  )
}

type LeadSummaryish = Customer['leads']
const EMPTY_LEADS: LeadSummaryish = { total: 0, open: 0, won: 0, lost: 0, untouched: 0 }

/** Turns the screen's filter state into the parameters the API takes, dropping
 *  the blanks. The two shapes differ on purpose: the screen wants empty strings
 *  so its controls stay controlled, the API wants absent keys. */
function asQuery(filters: Filters): CustomerQuery {
  return {
    segment: filters.segment || undefined,
    relationStage: filters.relationStage || undefined,
    product: filters.product || undefined,
    hasLead: (filters.hasLead || undefined) as LeadBucket | undefined,
    dateField: filters.from || filters.to ? filters.dateField : undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  }
}

function scopeNote(role: string): string {
  switch (role) {
    case 'sale':
      return 'Khách hàng trong sổ của bạn.'
    case 'team_lead':
      return 'Khách hàng của nhóm bạn phụ trách.'
    case 'bm':
      return 'Toàn bộ khách hàng của đơn vị.'
    default:
      return 'Toàn bộ khách hàng.'
  }
}
