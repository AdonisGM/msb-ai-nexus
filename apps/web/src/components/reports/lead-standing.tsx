import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { pct, type Funnel, type LeadState, type Standing } from '~/api/reports'
import { Card } from '~/components/ui/primitives'
import { fmtNum } from '~/lib/format'

/** Where the branch's leads have got to, as one ring.
 *
 *  Five places, and a lead is in exactly one of them — which is why this can
 *  be a ring at all. The funnel counts beside it (`contacted`, `advised`) are
 *  cumulative: a won lead was also contacted, so drawn as slices they would
 *  sum to half again more than the branch has and every percentage would be
 *  wrong. The server sends this split separately for that reason.
 *
 *  The hole in the middle carries the conversion rate, which is the one number
 *  a branch manager came to this card for. */
export function LeadStanding({ funnel }: { funnel: Funnel }) {
  const parts = funnel.standing.filter((part) => part.value > 0)

  return (
    <Card className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-medium">Lead đang ở đâu</h2>
        <span className="text-[11.5px] text-muted">{fmtNum(funnel.leads)} lead trong kỳ</span>
      </div>

      {funnel.leads === 0 ? (
        <p className="mt-3 text-[12px] text-muted">Chưa có lead nào trong kỳ.</p>
      ) : (
        <>
          <div className="relative mt-1 h-[168px] w-full">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 260, height: 168 }}
            >
              <PieChart>
                <Pie
                  data={parts}
                  dataKey="value"
                  nameKey="state"
                  innerRadius="62%"
                  outerRadius="92%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={1.5}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {parts.map((part) => (
                    <Cell key={part.state} fill={STATE[part.state].color} />
                  ))}
                </Pie>
                <Tooltip content={<StandingTooltip total={funnel.leads} />} />
              </PieChart>
            </ResponsiveContainer>

            {/** Centred over the hole rather than inside the SVG: the ring is
              *  sized in percentages, so an SVG label would have to guess the
              *  radius. Pointer events off so it never eats a hover. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="num text-[22px] leading-none font-semibold">
                {pct(funnel.crBps, 1)}
              </span>
              <span className="mt-1 text-[10.5px] text-muted">chốt thành công</span>
            </div>
          </div>

          <ul className="mt-1 flex flex-col gap-1.5">
            {funnel.standing.map((part) => (
              <li key={part.state} className="flex items-center gap-2 text-[12px]">
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: STATE[part.state].color }}
                />
                <span className="mr-auto truncate">{STATE[part.state].label}</span>
                <span className="num font-semibold">{fmtNum(part.value)}</span>
                <span className="num w-11 text-right text-[11px] text-muted">
                  {pct(part.shareBps)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

/** Said in the branch's words, not the schema's. "Đã tư vấn" alone would not
 *  say whether the lead is still live, and that is the whole question here. */
const STATE: Record<LeadState, { label: string; color: string }> = {
  new: { label: 'Chưa ai liên hệ', color: 'var(--c-neutral)' },
  contacted: { label: 'Đã liên hệ, đang theo', color: 'var(--c-info)' },
  advised: { label: 'Đã tư vấn, chờ chốt', color: 'var(--c-pending)' },
  won: { label: 'Chốt thành công', color: 'var(--c-success)' },
  lost: { label: 'Thất bại', color: 'var(--c-danger)' },
}

function StandingTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean
  payload?: Array<{ payload: Standing }>
  total?: number
}) {
  const part = payload?.[0]?.payload
  if (!active || !part) return null

  return (
    <div className="rounded-[9px] border border-line2 bg-surface px-3 py-2 text-[11.5px] shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="size-[7px] flex-none rounded-full"
          style={{ background: STATE[part.state].color }}
        />
        <span className="font-semibold">{STATE[part.state].label}</span>
      </div>
      <div className="mt-1 text-muted">
        {`${fmtNum(part.value)} lead, ${pct(part.shareBps)} của ${fmtNum(total ?? 0)}`}
      </div>
    </div>
  )
}
