import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { pct, type MonthRow } from '~/api/reports'
import { Card } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'

/** How each month went: what it closed, and how much of what it was asked for.
 *
 *  Three series on one frame, because they answer one question together and
 *  three cards could not. The bars are counts on the left scale; the line is a
 *  percentage on the right, and the dashed rule across it is the hundred.
 *
 *  Two different dates, which is how the branch reads a month:
 *
 *  - the bars are dated by **when the lead closed** — a deal landed in
 *    September is September's however long it took to get there;
 *  - the target behind the line comes from **leads raised in that month**,
 *    at the branch's own conversion rate.
 *
 *  So the line can pass a hundred, and should: a month that closed more than
 *  its own intake asked for did more than it was asked. What is deliberately
 *  not here is a quarterly target cut into three — that would draw a line the
 *  branch never agreed to.
 *
 *  Only the months that have something in them, which the server already
 *  enforces. A chart padded to twelve bars with eleven empty says the branch
 *  collapsed rather than that the system is new. */
export function Trend({ months, loading }: { months: MonthRow[]; loading: boolean }) {
  const totals = months.reduce(
    (sum, row) => ({
      won: sum.won + row.won,
      lost: sum.lost + row.lost,
      target: sum.target + row.targetWon,
    }),
    { won: 0, lost: 0, target: 0 },
  )

  return (
    <Card className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-[13px] font-medium">Kết quả {months.length} tháng gần nhất</h2>
          {/** Said out loud, because this is the one card on the page that
            *  does not follow the period picker above it. A trend of a single
            *  month is a single bar, so the window stays fixed — and a legend
            *  reading "Thất bại 540" under a header reading "Tháng 9" has to
            *  explain itself. */}
          <span className="text-[11px] text-muted">không đổi theo kỳ đã chọn</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-muted">
          <Key shape="bar" color="var(--c-success)" label={`Thành công ${totals.won}`} />
          <Key shape="bar" color="var(--c-danger)" label={`Thất bại ${totals.lost}`} />
          <Key shape="line" color="var(--accent)" label="% hoàn thành" />
        </div>
      </div>
      <p className="text-[11.5px] text-muted">
        Cột theo ngày chốt. Đường là số chốt được so với chỉ tiêu tháng — lead nhận trong
        tháng nhân {pct(months[0]?.targetBps ?? 600)}, cộng lại {totals.target} cơ hội cho cả{' '}
        {months.length} tháng.
      </p>

      {loading ? (
        <div className="mt-3">
          <BlockSkeleton rows={3} />
        </div>
      ) : months.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted">Chưa có cơ hội nào được chốt.</p>
      ) : (
        <TrendChart months={months} />
      )}
    </Card>
  )
}

function Key({ shape, color, label }: { shape: 'bar' | 'line'; color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {shape === 'bar' ? (
        <span className="h-2.5 w-2 rounded-[2px]" style={{ background: color }} />
      ) : (
        <span className="h-[2px] w-4 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  )
}

/* The drawing itself, on Recharts.
 *
 * Every colour and size below is a token from `tokens.css` rather than a
 * literal, so the chart follows the light/dark switch with the rest of the app
 * — Recharts has no idea a theme exists, and a hard-coded `#333` axis is
 * invisible on the dark ground. */

/** Recharts reads plain numbers, so the percentage comes out of basis points
 *  here and nowhere else. */
type Point = MonthRow & { label: string; done: number }

function TrendChart({ months }: { months: MonthRow[] }) {
  const data: Point[] = months.map((row, index) => ({
    ...row,
    /** The year appears on the first bar and wherever it turns over, so a
     *  window running Th 10 … Th 1 … Th 9 cannot be read as one calendar
     *  year. Repeating it on all twelve would crowd the axis. */
    label: monthLabel(row.month, index === 0 || row.month.endsWith('-01')),
    done: row.doneBps / 100,
  }))

  /** Both bar series share the left axis, so a win and a loss are the same
   *  size on the page — they are the same kind of thing, and scaling them
   *  apart would let a branch that loses six for every one it wins look even.
   *  The top is rounded up to a whole number of gridlines. */
  const countTop = niceTop(Math.max(1, ...months.map((row) => Math.max(row.won, row.lost))))

  /** The right axis always reaches a hundred, so the target rule is on the
   *  chart even in a quarter where nothing got near it — and it stops on a
   *  round fifty, so the last tick is not a stray "143%" crowding the one
   *  below it. */
  const doneTop = Math.max(100, Math.ceil(Math.max(...data.map((row) => row.done)) / 50) * 50)

  return (
    <div className="mt-3 h-[260px] w-full">
      {/** `initialDimension` gives the chart a frame to draw in before the
        *  resize observer has measured anything. Without it the first paint is
        *  an empty box that fills in a tick later, which reads as a chart that
        *  failed to load. */}
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 760, height: 260 }}
      >
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={4}
          />
          <YAxis
            yAxisId="count"
            domain={[0, countTop]}
            ticks={ticks(countTop)}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            width={44}
          />
          <YAxis
            yAxisId="done"
            orientation="right"
            domain={[0, doneTop]}
            ticks={percentTicks(doneTop)}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
            width={44}
          />
          <Tooltip
            content={<TrendTooltip />}
            cursor={{ fill: 'var(--sunken)', opacity: 0.6 }}
          />
          <Bar yAxisId="count" dataKey="won" name="Thành công" fill="var(--c-success)" radius={[2, 2, 0, 0]} maxBarSize={18} />
          <Bar yAxisId="count" dataKey="lost" name="Thất bại" fill="var(--c-danger)" radius={[2, 2, 0, 0]} maxBarSize={18} />
          {/** What the line is aiming at, drawn once instead of repeated in
            *  every caption. */}
          <ReferenceLine
            yAxisId="done"
            y={100}
            stroke="var(--accent)"
            strokeDasharray="4 4"
            strokeOpacity={0.45}
          />
          <Line
            yAxisId="done"
            type="monotone"
            dataKey="done"
            name="% hoàn thành"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--surface)', stroke: 'var(--accent)', strokeWidth: 2 }}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const AXIS_TICK = { fill: 'var(--muted)', fontSize: 10.5 } as const

/** Recharts' own tooltip prints the raw series names and numbers. This says
 *  the month in the branch's words, and adds the two figures behind the
 *  percentage — the target and the intake it came from — because "143%" on its
 *  own invites the question. */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null

  return (
    <div className="rounded-[9px] border border-line2 bg-surface px-3 py-2 text-[11.5px] shadow-lg">
      <div className="mb-1 font-semibold">{`Tháng ${Number(row.month.slice(5))}/${row.month.slice(0, 4)}`}</div>
      <TipRow color="var(--c-success)" label="Thành công" value={row.won} />
      <TipRow color="var(--c-danger)" label="Thất bại" value={row.lost} />
      <TipRow color="var(--accent)" label="Hoàn thành" value={`${Math.round(row.done)}%`} />
      <div className="mt-1 border-t border-line pt-1 text-[10.5px] text-muted">
        {`Nhận ${row.leads} lead, chỉ tiêu ${row.targetWon} cơ hội`}
      </div>
    </div>
  )
}

function TipRow({ color, label, value }: { color: string; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-[7px] flex-none rounded-full" style={{ background: color }} />
      <span className="mr-auto text-muted">{label}</span>
      <span className="num font-semibold">{value}</span>
    </div>
  )
}

/** Four bands plus the floor, which is as many as the frame carries without
 *  the labels crowding.
 *
 *  The step is one a person would say out loud — 20, not 15.5 — but chosen
 *  from the peak rather than from a fixed list: rounding 62 up to a flat 100
 *  wastes nearly half the frame, and on a branch that loses six deals for
 *  every one it wins the green bars are the ones that disappear into it. */
const BANDS = 4

function niceTop(peak: number): number {
  const rough = peak / BANDS
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))))
  /** Whole steps only. These are counts of deals, and a gridline at 2.5 deals
   *  prints as "3" beside a rule drawn at 2.5 — every label on the axis then
   *  sits slightly off the line it belongs to. */
  const step = [1, 2, 2.5, 5, 10]
    .map((unit) => unit * magnitude)
    .filter(Number.isInteger)
    .find((candidate) => candidate >= rough)

  return Math.max(BANDS, (step ?? magnitude * 10) * BANDS)
}

/** Every fifty up to the top, so 100% always lands on a gridline the dashed
 *  target rule can sit on. */
function percentTicks(top: number): number[] {
  return Array.from({ length: top / 50 + 1 }, (_, i) => i * 50)
}

function ticks(top: number): number[] {
  return Array.from({ length: BANDS + 1 }, (_, i) => Math.round((top * i) / BANDS))
}

function monthLabel(month: string, withYear = false): string {
  const [yyyy, mm] = month.split('-')
  return withYear ? `Th ${Number(mm)}/${yyyy.slice(2)}` : `Th ${Number(mm)}`
}
