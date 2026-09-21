import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { pct, type Forecast } from '~/api/reports'
import { Card } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'
import { fmtNum } from '~/lib/format'

/** Where the period lands if it carries on as it has been going.
 *
 *  The brief asks a branch manager for "khả năng hoàn thành cuối kỳ", and the
 *  temptation is a single confident number. This card refuses to print one.
 *  The server returns two estimates built from different evidence — the
 *  pipeline weighted by measured win rates, and the run rate off the clock —
 *  and what it shows is the span between them. When they agree the span is
 *  narrow and the forecast means something; when they are ten deals apart the
 *  branch does not have a forecast, and the card says that in the only way
 *  that cannot be misread: by being wide.
 *
 *  Neither estimate contains a probability anybody typed. Both are arithmetic
 *  over deals that closed, which is the rule the whole reporting service is
 *  built on — a figure a judge can follow back to rows they can open. */
export function ForecastCard({
  data,
  loading,
  periodLabel,
}: {
  data?: Forecast
  loading: boolean
  periodLabel: string
}) {
  if (loading || !data) {
    return (
      <Card className="w-full">
        <Head periodLabel={periodLabel} />
        <BlockSkeleton rows={4} />
      </Card>
    )
  }

  const { landed, expected, target, gap, pipeline, basis } = data

  /** Three pieces, so the certain part reads as certain: what has already
   *  closed is solid, what both estimates agree is still coming sits on it
   *  half-lit, and the span they disagree over is fainter still. */
  const row = [
    {
      name: 'kỳ này',
      landed: landed.won,
      /** From what has landed up to the pessimistic estimate: still expected,
       *  by both methods. */
      likely: Math.max(0, expected.low - landed.won),
      /** The part only the more generous method claims. */
      maybe: Math.max(0, expected.high - expected.low),
    },
  ]

  const ceiling = Math.max(expected.high, target.wonProjected, landed.won) * 1.15
  const met = expected.high >= target.wonProjected

  return (
    <Card className="w-full">
      <Head periodLabel={periodLabel} />

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="num text-[26px] leading-none font-semibold">
          {expected.low === expected.high
            ? fmtNum(expected.low)
            : `${fmtNum(expected.low)}–${fmtNum(expected.high)}`}
        </span>
        <span className="text-[12px] text-muted">
          cơ hội chốt được cả kỳ, đã có {fmtNum(landed.won)}
        </span>
      </div>

      {/** A fixed bar thickness and room above it for the threshold label.
        *  With one row of data Recharts gives the bar the whole band, which
        *  turned a progress strip into a 60px slab, and a 4px top margin
        *  clipped the label down to two stray ticks. */}
      <div className="mt-3 h-[52px] w-full">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 52 }}>
          <BarChart
            data={row}
            layout="vertical"
            barSize={14}
            margin={{ top: 20, right: 8, bottom: 4, left: 8 }}
          >
            <XAxis type="number" domain={[0, ceiling]} hide />
            <YAxis type="category" dataKey="name" hide />

            {/** No `LabelList` on any of the three. In this version of Recharts
              *  it does not render inside a horizontal bar at all — silently,
              *  which cost an afternoon the first time. The figures live in
              *  the line above the chart and in the grid below it. */}
            <Bar dataKey="landed" stackId="a" fill="var(--c-success)" isAnimationActive={false} />
            <Bar dataKey="likely" stackId="a" isAnimationActive={false}>
              <Cell fill="var(--c-success)" fillOpacity={0.42} />
            </Bar>
            <Bar dataKey="maybe" stackId="a" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              <Cell fill="var(--c-success)" fillOpacity={0.18} />
            </Bar>

            {/** The target for the whole period, not for the part of it that
              *  has happened — projected on the same clock as the wins, so the
              *  two sides of the comparison cover the same days. */}
            <ReferenceLine
              x={target.wonProjected}
              stroke={met ? 'var(--c-success)' : 'var(--c-danger)'}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              label={{
                value: `ngưỡng ${fmtNum(target.wonProjected)}`,
                position: 'top',
                fontSize: 10.5,
                fill: 'var(--muted)',
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-4">
        <Figure
          label="Còn thiếu hôm nay"
          value={fmtNum(gap.today)}
          note={`ngưỡng đến giờ là ${fmtNum(target.wonToDate)}`}
          tone={gap.today > 0 ? 'var(--c-warn)' : 'var(--c-success)'}
        />
        <Figure
          label="Còn thiếu cuối kỳ"
          value={gap.best === gap.worst ? fmtNum(gap.best) : `${fmtNum(gap.best)}–${fmtNum(gap.worst)}`}
          note={met ? 'đạt nếu đi theo hướng tốt' : 'chưa đạt ở cả hai hướng'}
          tone={met ? 'var(--c-success)' : 'var(--c-danger)'}
        />
        <Figure
          label="Nhịp kỳ này"
          value={fmtNum(expected.fromRunRate)}
          note={`nhịp cả năm nói ${fmtNum(expected.fromHistory)}`}
        />
        <Figure
          label="Phễu đáng giá"
          value={fmtNum(pipeline.worth)}
          note={`${fmtNum(pipeline.open)} cơ hội mở, không riêng kỳ này`}
        />
      </dl>

      {/** The working behind "phễu đáng giá", in the open: how many are
        *  standing where, how often that stage has gone on to win, and how
        *  long it takes when it does. A forecast whose workings are hidden is
        *  one nobody argues with and nobody trusts. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-[11.5px] text-muted">
        {pipeline.stages.map((stage) => (
          <li key={stage.stage} className="flex items-center gap-1.5">
            <span>{STAGE_LABEL[stage.stage] ?? stage.stage}</span>
            <span className="num font-semibold text-ink">{fmtNum(stage.open)}</span>
            <span className="num">× {pct(stage.winRateBps)}</span>
            {stage.medianDays !== null && (
              <span className="num">· {fmtNum(stage.medianDays)} ngày</span>
            )}
          </li>
        ))}
      </ul>

      {/** A rate measured off a handful of deals is noise wearing a decimal
        *  point. Said plainly rather than letting the number imply a
        *  confidence the data cannot carry. */}
      {basis.closedDeals < 20 && (
        <p className="mt-2 text-[11.5px] text-warn">
          {`Tỷ lệ đo từ ${fmtNum(basis.closedDeals)} cơ hội đã đóng trong 12 tháng — còn ít, hãy đọc như ước lượng thô.`}
        </p>
      )}
    </Card>
  )
}

function Head({ periodLabel }: { periodLabel: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[13px] font-medium">Dự báo cuối kỳ</h2>
      <span className="text-[11.5px] text-muted">{periodLabel}</span>
    </div>
  )
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted">{label}</dt>
      <dd className="num text-[17px] leading-tight font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
      <p className="truncate text-[10.5px] text-muted">{note}</p>
    </div>
  )
}

/** Only the three an open lead can be standing at — a closed one is not in the
 *  pipeline and has no rate to be weighted by. */
const STAGE_LABEL: Partial<Record<Forecast['pipeline']['stages'][number]['stage'], string>> = {
  new: 'Chưa liên hệ',
  contacted: 'Đang theo',
  advised: 'Chờ chốt',
}
