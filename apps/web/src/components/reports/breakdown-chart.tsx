import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { pct, type BreakdownRow } from '~/api/reports'
import { Card } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'
import { fmtNum } from '~/lib/format'

/** A breakdown where each bar says two things at once: how much of the branch
 *  this slice is, and how much of it actually landed.
 *
 *  The bar's full length is the count of opportunities, so the rows compare to
 *  each other as before. Inside it the same count is split by what happened —
 *  won, lost, still open — so "32 thẻ" and "5 trong đó đã chốt" are one mark
 *  instead of two cards. The three parts add to the total by construction: an
 *  opportunity has exactly one outcome.
 *
 *  A breakdown whose rows are all the same kind of thing (the blockers, which
 *  only sit on deals that went wrong) passes `split={false}` and gets one
 *  plain bar, because splitting it would draw two empty segments on every
 *  row. */
export function BreakdownChart({
  title,
  note,
  rows,
  loading,
  empty,
  label,
  split = true,
  color = 'var(--c-info)',
}: {
  title: string
  note?: string
  rows: BreakdownRow[]
  loading?: boolean
  empty?: string
  /** How a key is written for a person. Kept short — it has to fit the axis
   *  gutter of a card a third of the page wide. */
  label: (key: string) => string
  split?: boolean
  /** Only used when `split` is false. */
  color?: string
}) {
  const data = rows.map((row) => ({
    ...row,
    label: label(row.key),
    open: Math.max(0, row.total - row.won - row.lost),
  }))

  return (
    <Card className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-medium">{title}</h2>
        {note ? <span className="text-[11.5px] text-muted">{note}</span> : null}
      </div>

      {split ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-muted">
          {SERIES.map((series) => (
            <span key={series.key} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2 rounded-[2px]"
                style={{ background: series.color }}
              />
              {series.label}
            </span>
          ))}
        </div>
      ) : null}

      {loading ? (
        <BlockSkeleton rows={4} />
      ) : data.length === 0 ? (
        <p className="text-[12px] text-muted">{empty ?? 'Chưa có dữ liệu trong kỳ.'}</p>
      ) : (
        <div style={{ height: data.length * ROW_H + 18 }} className="w-full">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 460, height: data.length * ROW_H + 18 }}
          >
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 6, bottom: 0, left: 0 }}
              barCategoryGap="28%"
            >
              <CartesianGrid stroke="var(--line)" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={AXIS_W}
                tickLine={false}
                axisLine={false}
                /** The count rides on the axis tick rather than on a
                 *  `LabelList` past the end of the bar: Recharts 3 renders
                 *  bar labels in a layer this chart never reaches, so the
                 *  numbers simply never appeared. The tick always renders. */
                tick={<CategoryTick rows={data} />}
              />
              <Tooltip content={<BreakdownTooltip split={split} />} cursor={{ fill: 'var(--sunken)', opacity: 0.6 }} />

              {split ? (
                SERIES.map((series) => (
                  <Bar key={series.key} dataKey={series.key} stackId="a" fill={series.color} />
                ))
              ) : (
                <Bar dataKey="total" fill={color} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

/** Drawn in this order, which is the order the branch talks about an
 *  opportunity: it landed, it did not, or nobody knows yet. */
const SERIES = [
  { key: 'won', label: 'Chốt thành công', color: 'var(--c-success)' },
  { key: 'lost', label: 'Thất bại', color: 'var(--c-danger)' },
  { key: 'open', label: 'Đang xử lý', color: 'var(--c-neutral)' },
] as const

const ROW_H = 30

const AXIS_W = 140
/** How much of the gutter the count takes, measured from its right edge. */
const COUNT_W = 30

/** The row's name and its count, both inside the axis gutter.
 *
 *  Recharts hands a custom tick `x` at the gutter's right edge with the text
 *  anchored to end there, so both parts are placed backwards from it: the
 *  count sits against the bar, the name against the card edge. */
function CategoryTick(props: {
  x?: number
  y?: number
  rows?: Array<{ label: string; total: number }>
}) {
  const { x = 0, y = 0, rows = [] } = props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const index = (props as any).payload?.index as number | undefined
  const row = index === undefined ? undefined : rows[index]
  if (!row) return null

  return (
    <g>
      <text
        x={x - COUNT_W}
        y={y}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={11.5}
        fill="var(--ink2)"
      >
        {row.label}
      </text>
      <text
        x={x - 8}
        y={y}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={11.5}
        fontWeight={600}
        fill="var(--ink)"
      >
        {fmtNum(row.total)}
      </text>
    </g>
  )
}

function BreakdownTooltip({
  active,
  payload,
  split,
}: {
  active?: boolean
  payload?: Array<{ payload: BreakdownRow & { label: string; open: number } }>
  split?: boolean
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null

  return (
    <div className="rounded-[9px] border border-line2 bg-surface px-3 py-2 text-[11.5px] shadow-lg">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="font-semibold">{row.label}</span>
        <span className="num ml-auto font-semibold">{fmtNum(row.total)}</span>
        <span className="text-muted">{pct(row.shareBps)}</span>
      </div>

      {split ? (
        <>
          {SERIES.map((series) => (
            <div key={series.key} className="flex items-center gap-2">
              <span
                className="size-[7px] flex-none rounded-full"
                style={{ background: series.color }}
              />
              <span className="mr-auto text-muted">{series.label}</span>
              <span className="num font-semibold">{fmtNum(row[series.key])}</span>
            </div>
          ))}
          <div className="mt-1 border-t border-line pt-1 text-[10.5px] text-muted">
            {row.won + row.lost > 0
              ? `Chốt được ${pct(row.winBps)} số đã ngã ngũ`
              : 'Chưa có cơ hội nào ngã ngũ'}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** The same rows read the other way: not how big each slice is, but how often
 *  it lands when it is worked.
 *
 *  A share and a rate are different questions and must not share a chart — a
 *  product the branch barely sells can have the best win rate on the page, and
 *  a bar chart that mixed the two would make the first look like the second.
 *
 *  Measured against what has been decided, not against everything: a product
 *  with ten leads still open has no win rate yet, and counting those as losses
 *  would say it fails. The dashed rule is the branch's own threshold. */
export function WinRateChart({
  title,
  note,
  rows,
  loading,
  label,
  targetBps,
}: {
  title: string
  note?: string
  rows: BreakdownRow[]
  loading?: boolean
  label: (key: string) => string
  targetBps: number
}) {
  const data = rows
    .filter((row) => row.won + row.lost > 0)
    .map((row) => ({
      ...row,
      label: label(row.key),
      decided: row.won + row.lost,
      rate: row.winBps / 100,
    }))
    .sort((a, b) => b.rate - a.rate)

  return (
    <Card className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-medium">{title}</h2>
        {note ? <span className="text-[11.5px] text-muted">{note}</span> : null}
      </div>

      {loading ? (
        <BlockSkeleton rows={4} />
      ) : data.length === 0 ? (
        <p className="text-[12px] text-muted">Chưa có cơ hội nào ngã ngũ trong kỳ.</p>
      ) : (
        <div style={{ height: data.length * ROW_H + 18 }} className="w-full">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 300, height: data.length * ROW_H + 18 }}
          >
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 6, bottom: 0, left: 0 }}
              barCategoryGap="28%"
            >
              <CartesianGrid stroke="var(--line)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="label"
                width={AXIS_W}
                tickLine={false}
                axisLine={false}
                tick={<RateTick rows={data} />}
              />
              <Tooltip content={<RateTooltip />} cursor={{ fill: 'var(--sunken)', opacity: 0.6 }} />
              <ReferenceLine
                x={targetBps / 100}
                stroke="var(--accent)"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
              <Bar dataKey="rate" radius={[0, 2, 2, 0]}>
                {data.map((row) => (
                  <Cell
                    key={row.key}
                    /** Above the branch threshold or below it — the one thing
                     *  a team lead is reading this card to find out. */
                    fill={row.winBps >= targetBps ? 'var(--c-success)' : 'var(--c-warn)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

function RateTick(props: {
  x?: number
  y?: number
  rows?: Array<{ label: string; rate: number }>
}) {
  const { x = 0, y = 0, rows = [] } = props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const index = (props as any).payload?.index as number | undefined
  const row = index === undefined ? undefined : rows[index]
  if (!row) return null

  return (
    <g>
      <text
        x={x - COUNT_W - 6}
        y={y}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={11.5}
        fill="var(--ink2)"
      >
        {row.label}
      </text>
      <text
        x={x - 8}
        y={y}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={11.5}
        fontWeight={600}
        fill="var(--ink)"
      >
        {`${row.rate.toFixed(0)}%`}
      </text>
    </g>
  )
}

function RateTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: BreakdownRow & { label: string; decided: number; rate: number } }>
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null

  return (
    <div className="rounded-[9px] border border-line2 bg-surface px-3 py-2 text-[11.5px] shadow-lg">
      <div className="font-semibold">{row.label}</div>
      <div className="mt-1 text-muted">
        {`Chốt ${fmtNum(row.won)} trên ${fmtNum(row.decided)} cơ hội đã ngã ngũ`}
      </div>
      <div className="text-muted">{`Còn ${fmtNum(row.total - row.decided)} đang xử lý`}</div>
    </div>
  )
}
