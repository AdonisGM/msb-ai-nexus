import { useMemo, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  breakdownQuery,
  byOwnerQuery,
  byTeamQuery,
  funnelQuery,
  monthlyQuery,
  pct,
  type BreakdownRow,
  type Counts,
  type Funnel,
  type MonthRow,
  type OwnerRow,
  type TeamRow,
} from '~/api/reports'
import { opportunitiesQuery, type Opportunity, type OpportunityPage } from '~/api/opportunities'
import { Card, Chip, cx } from '~/components/ui/primitives'
import { BlockSkeleton, ErrorState } from '~/components/ui/query-state'
import { SegmentedControl } from '~/components/ui/segmented'
import { t, tCode } from '~/i18n'
import { daysSince, dmDate } from '~/lib/dates'
import { fmtNum, initials } from '~/lib/format'
import { PERIODS, resolvePeriod, type PeriodId } from '~/lib/period'

export const Route = createFileRoute('/_app/dashboard')({ component: DashboardScreen })

/** A live lead untouched for this long. The design's number, not one the
 *  branch has agreed — named here and in the reporting service so the two
 *  cannot drift. */
const STALE_DAYS = 7

/** Resolved once: the labels are "Tháng 9", "Quý 3", "Năm 2026" — they change
 *  when the calendar does, not when the screen re-renders. */
const PERIOD_OPTIONS = PERIODS.map((id) => ({ id, label: resolvePeriod(id).label }))

function DashboardScreen() {
  const { user } = Route.useRouteContext()
  const [periodId, setPeriodId] = useState<PeriodId>('m')
  const period = useMemo(() => resolvePeriod(periodId), [periodId])
  const range = { from: period.from, to: period.to }

  const isLead = user.role === 'team_lead'
  const isBm = user.role === 'bm'

  if (!isLead && !isBm) return <NoContent />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[15px] font-semibold tracking-tight">
            {isLead ? 'Việc cần đốc thúc' : 'Tình hình chi nhánh'}
          </h1>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {isLead ? 'Nhóm bạn phụ trách' : 'Toàn đơn vị'}, {period.note}
          </p>
        </div>

        <SegmentedControl
          size="md"
          value={periodId}
          onChange={setPeriodId}
          options={PERIOD_OPTIONS}
        />
      </div>

      {isLead ? (
        <LeadDashboard range={range} label={period.label} daysLeft={period.daysLeft} />
      ) : (
        <BranchDashboard range={range} />
      )}
    </div>
  )
}

/* ────────────────────────────── Team lead ───────────────────────────────── */

function LeadDashboard({
  range,
  label,
  daysLeft,
}: {
  range: { from: string; to: string }
  label: string
  daysLeft: number
}) {
  const navigate = useNavigate()
  const funnel = useQuery(funnelQuery(range))
  const owners = useQuery(byOwnerQuery(range))
  const products = useQuery(breakdownQuery('product', range))
  const overdue = useQuery(opportunitiesQuery({ overdue: true, sort: 'due', pageSize: 6 }))
  const waiting = useQuery(opportunitiesQuery({ awaitingConfirm: true, pageSize: 6 }))

  if (funnel.isError) {
    return <ErrorState what="số liệu" error={funnel.error} onRetry={() => void funnel.refetch()} />
  }
  if (funnel.isPending || owners.isPending) return <BlockSkeleton rows={8} />

  const rows = owners.data ?? []
  const sum = (key: keyof Counts) => rows.reduce((total, row) => total + row[key], 0)

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        tiles={[
          {
            label: `Chốt trong ${label.toLowerCase()}`,
            value: funnel.data.won,
            sub: `trên ${funnel.data.leads} lead`,
            pct: funnel.data.targetBps > 0 ? funnel.data.crBps / funnel.data.targetBps : 0,
            note:
              funnel.data.gap > 0
                ? `Còn thiếu ${funnel.data.gap} cơ hội, còn ${daysLeft} ngày`
                : 'Đã đạt ngưỡng kỳ này',
          },
          {
            label: 'Quá hạn xử lý',
            value: sum('overdue'),
            sub: `${sum('open')} đang mở`,
            tone: sum('overdue') > 0 ? 'var(--danger)' : undefined,
            note: worstAt(rows, 'overdue'),
          },
          {
            label: `Im lặng quá ${STALE_DAYS} ngày`,
            value: sum('stale'),
            tone: sum('stale') > 0 ? 'var(--warn)' : undefined,
            note: worstAt(rows, 'stale'),
          },
          {
            label: 'Chưa ai gọi lần nào',
            value: sum('untouched'),
            note: worstAt(rows, 'untouched'),
          },
        ]}
      />

      <Card padded={false} className="overflow-hidden">
        <CardHead
          title="Xếp hạng sale trong nhóm"
          note={`${rows.length} người`}
        />
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div
              className={cx(
                'grid items-center gap-3 border-y border-line bg-sunken/40 px-4 py-2 text-[11px] text-muted',
                RANK_COLS,
              )}
            >
              <span>#</span>
              <span>Sale</span>
              <span>Chốt so ngưỡng</span>
              <span className="text-right">Đang mở</span>
              <span className="text-right">Quá hạn</span>
              <span className="text-right">Còn thiếu</span>
            </div>
            {rows.length === 0 ? (
              <Empty title="Chưa có cơ hội nào trong kỳ" note="Nới khoảng thời gian để xem lại." />
            ) : (
              rows.map((row, index) => (
                <div
                  key={row.ownerId}
                  className={cx(
                    'grid w-full items-center gap-3 border-t border-line px-4 py-2.5 text-[12.5px]',
                    RANK_COLS,
                  )}
                >
                  <span className={cx('num', index === 0 && 'text-[var(--success)]')}>
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={row.ownerName} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{row.ownerName}</span>
                      <span className="text-[10.5px] text-muted">
                        {row.customers} khách phụ trách
                      </span>
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11.5px]">
                      {pct(row.crBps, 1)} so {pct(row.targetBps)}
                    </span>
                    <Bar value={row.crBps} of={row.targetBps} />
                  </span>
                  <span className="num text-right">{row.open}</span>
                  <span
                    className={cx(
                      'num text-right',
                      row.overdue >= 4
                        ? 'text-danger'
                        : row.overdue > 0
                          ? 'text-[var(--warn)]'
                          : 'text-muted',
                    )}
                  >
                    {row.overdue}
                  </span>
                  <span
                    className={cx(
                      'num text-right',
                      row.gap === 0 ? 'text-[var(--success)]' : '',
                    )}
                  >
                    {row.gap === 0 ? 'Đạt' : row.gap}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-4">
          <LeadList
            title="Cơ hội quá hạn cần can thiệp"
            dot="var(--c-danger)"
            query={overdue}
            empty="Không có cơ hội nào quá hạn"
            onOpen={(id) =>
              void navigate({ to: '/opportunities/$id', params: { id } })
            }
            right={(deal) => (
              <span className="text-[11px] text-danger">
                Quá {daysSince(deal.dueDate) ?? 0} ngày
              </span>
            )}
          />

          {/** The queue this role exists for. It changes no figure above — a
            *  win counts the moment the salesperson records it — so it sits
            *  apart from the numbers rather than among them. */}
          <LeadList
            title="Chờ bạn đối chiếu"
            dot="var(--c-warn)"
            query={waiting}
            empty="Không còn gì chờ đối chiếu"
            onOpen={(id) =>
              void navigate({ to: '/opportunities/$id', params: { id } })
            }
            right={(deal) => (
              <span className="text-[11px] text-muted">
                chốt {deal.closedAt ? dmDate(deal.closedAt) : ''}
              </span>
            )}
          />
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <BreakdownCard
            title="Tỷ lệ chốt theo sản phẩm"
            note="trên số đã ngã ngũ"
            query={products}
            render={(row) => ({
              label: t(`product.${row.key as 'card'}`),
              lead: row.won + row.lost > 0 ? pct(row.winBps) : '—',
              side: `${row.won} trên ${row.won + row.lost}`,
              bps: row.winBps,
              of: BPS_FULL,
            })}
          />
        </div>
      </div>
    </div>
  )
}

const RANK_COLS = 'grid-cols-[32px_minmax(0,1.5fr)_150px_74px_82px_90px]'

/* ───────────────────────────── Branch manager ───────────────────────────── */

function BranchDashboard({ range }: { range: { from: string; to: string } }) {
  const funnel = useQuery(funnelQuery(range))
  const teams = useQuery(byTeamQuery(range))
  const months = useQuery(monthlyQuery({}))
  const [products, blockers, segments] = useQueries({
    queries: [
      breakdownQuery('product', range),
      breakdownQuery('blocker', range),
      breakdownQuery('segment', range),
    ],
  })

  if (funnel.isError) {
    return <ErrorState what="số liệu" error={funnel.error} onRetry={() => void funnel.refetch()} />
  }
  if (funnel.isPending) return <BlockSkeleton rows={8} />

  const f = funnel.data

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        tiles={[
          {
            label: 'Cơ hội chốt được',
            value: f.won,
            sub: `trên ${fmtNum(f.leads)} lead`,
            pct: f.targetBps > 0 ? f.crBps / f.targetBps : 0,
            note: `${f.lost} thất bại, ${f.leads - f.won - f.lost} đang mở`,
          },
          {
            label: 'Tỷ lệ chuyển đổi',
            value: pct(f.crBps, 1),
            sub: `ngưỡng ${pct(f.targetBps)}`,
            tone: f.crBps >= f.targetBps ? 'var(--success)' : 'var(--danger)',
            note: `${fmtNum(f.leads)} lead được giao`,
          },
          {
            label: 'Còn thiếu để đạt ngưỡng',
            value: f.gap,
            sub: 'cơ hội',
            tone: f.gap > 0 ? 'var(--warn)' : 'var(--success)',
            note: f.gap === 0 ? 'Đã vượt ngưỡng' : `cần thêm ${f.gap} deal nữa`,
          },
          {
            label: 'Rơi nhiều nhất ở bước',
            value: f.weakestStep ? STEP_LABEL[f.weakestStep] : '—',
            note: weakestNote(f),
          },
        ]}
      />

      <Card>
        <CardHead
          title="Phễu khai thác"
          note={`${fmtNum(f.leads)} lead vào, ${f.won} deal ra, chuyển đổi ${pct(f.crBps, 1)}`}
          bare
        />
        <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
          {[
            {
              label: 'Lead được giao',
              value: f.leads,
              color: 'var(--c-neutral)',
              note: 'gốc của phễu',
            },
            {
              label: 'Đã tiếp cận',
              value: f.contacted,
              color: 'var(--c-info)',
              note: kept(f.steps[0]),
            },
            {
              label: 'Đã tư vấn',
              value: f.advised,
              color: 'var(--c-pending)',
              note: kept(f.steps[1]),
            },
            {
              /** Counted against every lead, not against "đã tư vấn": a lead
               *  can be won off a first call without ever being advised, so
               *  wins over advised can pass 100% and would read as nonsense
               *  in a column of retention rates. */
              label: 'Chốt thành công',
              value: f.won,
              color: 'var(--c-success)',
              note: `${pct(f.crBps, 1)} trên tổng lead`,
            },
          ].map((column) => (
            <div key={column.label} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: column.color }}
                />
                {column.label}
              </span>
              <span className="num text-[24px] leading-none font-semibold">
                {fmtNum(column.value)}
              </span>
              <span className="h-2 w-full overflow-hidden rounded-full bg-sunken">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${f.leads > 0 ? Math.max(2, (column.value / f.leads) * 100) : 0}%`,
                    background: column.color,
                  }}
                />
              </span>
              <span className="text-[11px] text-muted">{column.note}</span>
            </div>
          ))}
        </div>
      </Card>

      <Trend months={months.data ?? []} loading={months.isPending} />

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_300px]">
          <BreakdownCard
            title="Cơ cấu theo sản phẩm"
            note="số cơ hội"
            query={products}
            render={(row) => ({
              label: t(`product.${row.key as 'card'}`),
              lead: String(row.total),
              side: pct(row.shareBps),
              bps: row.shareBps,
              of: maxShare(products.data),
            })}
          />
        </div>

        <div className="flex min-w-0 flex-[1_1_300px]">
          <BreakdownCard
            title="Cơ cấu theo phân khúc"
            note="số cơ hội"
            query={segments}
            render={(row) => ({
              label: t(`segment.${row.key as 'sse'}`),
              lead: String(row.total),
              side: pct(row.shareBps),
              bps: row.shareBps,
              of: maxShare(segments.data),
              color: row.key === 'sse' ? 'var(--c-info)' : 'var(--c-pending)',
            })}
          />
        </div>

        <div className="flex min-w-0 flex-[1_1_300px]">
          <BreakdownCard
            title="Lý do thất bại"
            note={`${f.lost} cơ hội thất bại`}
            query={blockers}
            empty="Chưa có cơ hội nào ghi điểm vướng"
            render={(row) => ({
              label: tCode('blocker', row.key, row.key),
              lead: String(row.total),
              side: pct(row.shareBps),
              bps: row.shareBps,
              of: maxShare(blockers.data),
              color: 'var(--c-danger)',
            })}
          />
        </div>
      </div>

      <Teams rows={teams.data ?? []} loading={teams.isPending} />
    </div>
  )
}

function kept(step: Funnel['steps'][number] | undefined): string {
  if (!step) return ''
  return `giữ ${pct(step.keptBps)} bước trước, rơi ${step.dropped}`
}

const STEP_LABEL: Record<Funnel['steps'][number]['step'], string> = {
  contacted: 'Tiếp cận',
  advised: 'Tư vấn',
  won: 'Chốt',
}

/** Names the leak from the measured figures rather than asserting one. Every
 *  step can be the worst, and a caption that picks one without checking sends
 *  somebody to fix the wrong thing. */
function weakestNote(f: Funnel): string {
  const step = f.steps.find((s) => s.step === f.weakestStep)
  if (!step) return 'Chưa đủ dữ liệu'
  return `chỉ giữ ${pct(step.keptBps)}, mất ${step.dropped} cơ hội`
}

/* ─────────────────────────────── Teams table ────────────────────────────── */

function Teams({ rows, loading }: { rows: TeamRow[]; loading: boolean }) {
  /** Three bands rather than a sorted list: a branch manager reads this to
   *  find who needs a conversation, and a rank puts somebody at the bottom
   *  every week whether or not anything is wrong. */
  const bands = [
    { id: 'ok', label: 'Đạt ngưỡng', color: 'var(--c-success)', bg: 'var(--success-soft)' },
    { id: 'near', label: 'Sát ngưỡng', color: 'var(--c-warn)', bg: 'var(--warn-soft)' },
    { id: 'low', label: 'Cần can thiệp', color: 'var(--c-danger)', bg: 'var(--danger-soft)' },
  ] as const

  const banded = bands
    .map((band) => ({
      ...band,
      rows: rows.filter((row) => bandOf(row) === band.id),
    }))
    .filter((band) => band.rows.length > 0)

  return (
    <Card padded={false} className="overflow-hidden">
      <CardHead
        title="Các nhóm trong chi nhánh"
        note={`${rows.length} nhóm, ${rows.reduce((n, r) => n + r.heads, 0)} sale`}
      />

      {loading ? (
        <div className="p-4 pt-0">
          <BlockSkeleton rows={3} />
        </div>
      ) : rows.length === 0 ? (
        <Empty title="Chưa có nhóm nào có cơ hội trong kỳ" note="Nới khoảng thời gian." />
      ) : (
        banded.map((band) => (
          <div key={band.id}>
            <div
              className="flex items-center gap-2 border-y border-line px-4 py-1.5 text-[11.5px] font-semibold"
              style={{ background: band.bg }}
            >
              <span className="size-[7px] rounded-full" style={{ background: band.color }} />
              {band.label}
              <span className="ml-auto font-normal text-muted">{band.rows.length} nhóm</span>
            </div>
            {band.rows.map((row) => (
              <div
                key={`${row.leadId}-${row.segment}`}
                className="flex flex-wrap items-center gap-3.5 border-b border-line px-4 py-2.5 last:border-b-0 text-[12.5px]"
              >
                <span className="flex min-w-0 flex-[1_1_180px] flex-col">
                  <span className="truncate font-semibold">
                    {t(`segment.${row.segment}`)}
                  </span>
                  <span className="text-[10.5px] text-muted">
                    Trưởng nhóm {row.leadName} · {row.heads} sale
                  </span>
                </span>
                <Metric label="Lead được giao" value={fmtNum(row.leads)} />
                <Metric label="Chốt thành công" value={String(row.won)} />
                <Metric
                  label="Tỷ lệ chuyển đổi"
                  value={pct(row.crBps, 1)}
                  sub={`ngưỡng ${pct(row.targetBps)}`}
                  big
                />
                <Metric
                  label="Còn thiếu để đạt"
                  value={row.gap === 0 ? 'Đã đạt' : `${row.gap} deal`}
                />
              </div>
            ))}
          </div>
        ))
      )}
    </Card>
  )
}

function bandOf(row: TeamRow): 'ok' | 'near' | 'low' {
  if (row.crBps >= row.targetBps) return 'ok'
  /** Two thirds of the way there. A single threshold would put somebody one
   *  deal short in the same band as somebody who has sold nothing. */
  if (row.crBps >= (row.targetBps * 2) / 3) return 'near'
  return 'low'
}

function Metric({
  label,
  value,
  sub,
  big,
}: {
  label: string
  value: string
  sub?: string
  big?: boolean
}) {
  return (
    <span className="flex flex-[0_1_128px] flex-col">
      <span className="text-[10.5px] text-muted">{label}</span>
      <span className={cx('num font-semibold', big ? 'text-[15px]' : 'text-[13px]')}>{value}</span>
      {sub ? <span className="text-[10.5px] text-muted">{sub}</span> : null}
    </span>
  )
}

/* ─────────────────────────────── The trend ──────────────────────────────── */

/** Wins per month, as bars.
 *
 *  No target line beside them: targets are set per quarter, and splitting one
 *  into three equal months would draw a line the branch never agreed to.
 *
 *  Only the months that have something in them, which the server already
 *  enforces. A chart padded to twelve bars with eleven empty says the branch
 *  collapsed rather than that the system is new. */
function Trend({ months, loading }: { months: MonthRow[]; loading: boolean }) {
  const max = Math.max(1, ...months.map((row) => row.won))

  return (
    <Card>
      <CardHead title="Cơ hội chốt theo tháng" note="theo ngày chốt" bare />

      {loading ? (
        <div className="mt-3">
          <BlockSkeleton rows={3} />
        </div>
      ) : months.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted">Chưa có cơ hội nào được chốt.</p>
      ) : (
        <div className="mt-4 flex h-[180px] items-end gap-2.5">
          {months.map((row) => (
            <div key={row.month} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="num text-[11.5px] font-semibold">{row.won}</span>
              <span
                className="w-[34%] min-w-[18px] rounded-t-[5px] bg-accent"
                style={{ height: `${(row.won / max) * 130}px` }}
              />
              <span className="text-[10.5px] text-muted">{monthLabel(row.month)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function monthLabel(month: string): string {
  const [, mm] = month.split('-')
  return `Th ${Number(mm)}`
}

/* ───────────────────────────────── Shared ───────────────────────────────── */

const BPS_FULL = 10_000

type Tile = {
  label: string
  value: number | string
  sub?: string
  /** Progress against the target, as a ratio. Drawn as a bar when present. */
  pct?: number
  tone?: string
  note?: string
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface px-4 py-3.5"
        >
          <span className="text-[11.5px] text-muted">{tile.label}</span>
          <span className="flex items-baseline gap-1.5">
            <span
              className="num text-[27px] leading-none font-semibold"
              style={{ color: tile.tone }}
            >
              {typeof tile.value === 'number' ? fmtNum(tile.value) : tile.value}
            </span>
            {tile.sub ? <span className="text-[12px] text-muted">{tile.sub}</span> : null}
          </span>
          {tile.pct !== undefined ? (
            <span className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.min(100, Math.round(tile.pct * 100))}%`,
                  background: paceColor(tile.pct),
                }}
              />
            </span>
          ) : null}
          {tile.note ? <span className="text-[11px] text-muted">{tile.note}</span> : null}
        </div>
      ))}
    </div>
  )
}

function paceColor(ratio: number): string {
  if (ratio >= 0.95) return 'var(--c-success)'
  if (ratio >= 0.7) return 'var(--c-warn)'
  return 'var(--c-danger)'
}

function Bar({ value, of }: { value: number; of: number }) {
  const ratio = of > 0 ? value / of : 0
  return (
    <span className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.min(100, ratio * 100)}%`, background: paceColor(ratio) }}
      />
    </span>
  )
}

function BreakdownCard({
  title,
  note,
  query,
  empty,
  render,
}: {
  title: string
  note?: string
  query: { data?: BreakdownRow[]; isPending: boolean }
  empty?: string
  render: (row: BreakdownRow) => {
    label: string
    lead: string
    side: string
    bps: number
    of: number
    color?: string
  }
}) {
  return (
    <Card className="w-full">
      <CardHead title={title} note={note} bare />
      {query.isPending ? (
        <div className="mt-3">
          <BlockSkeleton rows={4} />
        </div>
      ) : (query.data ?? []).length === 0 ? (
        <p className="mt-3 text-[12px] text-muted">{empty ?? 'Chưa có dữ liệu trong kỳ.'}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {(query.data ?? []).map((row) => {
            const line = render(row)
            return (
              <div key={row.key} className="flex flex-col gap-1">
                <span className="flex items-baseline gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">{line.label}</span>
                  <span className="num font-semibold">{line.lead}</span>
                  <span className="num w-10 text-right text-[11px] text-muted">{line.side}</span>
                </span>
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${line.of > 0 ? Math.max(2, (line.bps / line.of) * 100) : 0}%`,
                      background: line.color ?? 'var(--accent)',
                    }}
                  />
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function maxShare(rows?: BreakdownRow[]): number {
  return Math.max(1, ...(rows ?? []).map((row) => row.shareBps))
}

/** A short list of leads with one figure on the right. Used for both of the
 *  team lead's queues, which differ only in what that figure says. */
function LeadList({
  title,
  dot,
  query,
  empty,
  onOpen,
  right,
}: {
  title: string
  dot: string
  query: { data?: OpportunityPage; isPending: boolean }
  empty: string
  onOpen: (id: string) => void
  right: (deal: Opportunity) => ReactNode
}) {
  const rows = query.data?.rows ?? []

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="size-[7px] rounded-full" style={{ background: dot }} />
        <h2 className="text-[13px] font-medium">{title}</h2>
        <span className="ml-auto text-[11.5px] text-muted">{query.data?.total ?? 0}</span>
      </div>

      {query.isPending ? (
        <div className="p-4 pt-0">
          <BlockSkeleton rows={3} />
        </div>
      ) : rows.length === 0 ? (
        <Empty title={empty} />
      ) : (
        rows.map((deal) => (
          <button
            key={deal.id}
            type="button"
            onClick={() => onOpen(deal.id)}
            className="flex w-full cursor-pointer flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-left text-[12.5px] transition-colors hover:bg-sunken/50"
          >
            <span className="flex min-w-0 flex-[1_1_200px] flex-col">
              <span className="truncate font-medium">{deal.customerName}</span>
              <span className="font-mono text-[10.5px] text-muted">{deal.code}</span>
            </span>
            <span className="flex-[0_1_120px] truncate text-[11.5px]">
              {t(`product.${deal.product as 'card'}`)}
            </span>
            <span className="flex-[0_1_110px] truncate text-[11.5px] text-muted">
              {deal.ownerName}
            </span>
            {deal.blockerCode ? (
              <Chip tone={{ fg: 'var(--warn)', bg: 'var(--warn-soft)' }}>
                {tCode('blocker', deal.blockerCode)}
              </Chip>
            ) : null}
            <span className="ml-auto flex-none">{right(deal)}</span>
          </button>
        ))
      )}
    </Card>
  )
}

/** Who is carrying the most of whatever the tile counts. Read from the rows
 *  rather than written into the caption, so it names whoever it actually is. */
function worstAt(rows: OwnerRow[], key: 'overdue' | 'stale' | 'untouched'): string {
  const worst = rows.reduce<OwnerRow | null>(
    (top, row) => (top === null || row[key] > top[key] ? row : top),
    null,
  )
  if (!worst || worst[key] === 0) return 'Không có ai đang tồn'
  return `${worst.ownerName} giữ nhiều nhất, ${worst[key]} cơ hội`
}

function CardHead({
  title,
  note,
  bare,
}: {
  title: string
  note?: string
  bare?: boolean
}) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-baseline justify-between gap-2.5',
        !bare && 'px-4 py-3',
      )}
    >
      <h2 className="text-[13px] font-medium">{title}</h2>
      {note ? <span className="text-[11.5px] text-muted">{note}</span> : null}
    </div>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid size-[26px] flex-none place-items-center rounded-full border border-line2 bg-sunken text-[10px] font-semibold text-muted">
      {initials(name)}
    </span>
  )
}

function Empty({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 border-t border-line px-4 py-10 text-center">
      <span className="text-[12.5px]">{title}</span>
      {note ? <span className="text-[11.5px] text-muted">{note}</span> : null}
    </div>
  )
}

/** Sale and admin land here only by typing the path. The menu hides it, but
 *  hiding a link is a courtesy rather than a control. */
function NoContent() {
  return (
    <Card>
      <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <span className="text-[14px] font-semibold">Trang này dành cho quản lý</span>
        <p className="max-w-[420px] text-[12px] leading-relaxed text-muted">
          Số liệu tổng hợp chỉ mở cho trưởng nhóm và giám đốc đơn vị.
        </p>
      </div>
    </Card>
  )
}
