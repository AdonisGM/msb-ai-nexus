import { Cell, Pie, PieChart } from 'recharts'
import type { LeadSummary } from '~/api/customers'
import { cx } from '~/components/ui/primitives'

/** The four buckets, in the order a lead moves through them, with the colour
 *  each one keeps everywhere it appears.
 *
 *  Declared once and read by the bar, the donut and the legend, because three
 *  copies of this list is three chances for a colour to mean one thing on a
 *  card and another on the row beneath it. */
export const BUCKETS = [
  { id: 'untouched', label: 'Chưa xử lý', color: 'var(--c-neutral)' },
  { id: 'open', label: 'Đang xử lý', color: 'var(--c-info)' },
  { id: 'won', label: 'Hoàn thành', color: 'var(--c-success)' },
  { id: 'lost', label: 'Thất bại', color: 'var(--c-danger)' },
] as const satisfies ReadonlyArray<{ id: keyof LeadSummary; label: string; color: string }>

export type Bucket = (typeof BUCKETS)[number]['id']

/** One row's leads, as a single bar.
 *
 *  The four segments fill the track exactly because the server guarantees they
 *  add up to the total. A customer with nothing shows an empty track rather
 *  than disappearing — "no leads yet" is a state worth seeing on a list whose
 *  job is to find people nobody has worked. */
export function LeadBar({ leads, className }: { leads: LeadSummary; className?: string }) {
  if (leads.total === 0) {
    return (
      <span
        className={cx('flex h-1.5 w-full rounded-full bg-sunken', className)}
        aria-label="Chưa có cơ hội"
      />
    )
  }

  return (
    <span
      className={cx('flex h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)}
      role="img"
      aria-label={BUCKETS.filter((bucket) => leads[bucket.id] > 0)
        .map((bucket) => `${bucket.label} ${leads[bucket.id]}`)
        .join(', ')}
    >
      {BUCKETS.map((bucket) =>
        leads[bucket.id] > 0 ? (
          <span
            key={bucket.id}
            style={{
              width: `${(leads[bucket.id] / leads.total) * 100}%`,
              background: bucket.color,
            }}
          />
        ) : null,
      )}
    </span>
  )
}

/** The same four figures as a ring, for the card above the table.
 *
 *  The four parts are disjoint and the server guarantees they add to the
 *  total, which is what lets this be a ring at all.
 *
 *  Nothing to show is drawn as an empty ring, not as an absent one, so the
 *  card keeps its shape while a filter is being narrowed down to nothing —
 *  Recharts draws no sectors for a dataset of zeroes, so the empty track is a
 *  plain circle underneath. */
export function LeadDonut({
  leads,
  size = 132,
  children,
}: {
  leads: LeadSummary
  size?: number
  children?: React.ReactNode
}) {
  const parts = BUCKETS.map((bucket) => ({ ...bucket, value: leads[bucket.id] })).filter(
    (part) => part.value > 0,
  )

  return (
    <span className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
      <span
        className="absolute rounded-full"
        style={{
          width: size,
          height: size,
          /** The track, as a ring rather than a disc: a filled circle would
           *  show through the gaps Recharts leaves between sectors. */
          background: 'var(--sunken)',
          maskImage: `radial-gradient(circle, transparent ${size / 2 - 17}px, black ${size / 2 - 17}px)`,
          WebkitMaskImage: `radial-gradient(circle, transparent ${size / 2 - 17}px, black ${size / 2 - 17}px)`,
        }}
      />

      <PieChart width={size} height={size} className="absolute">
        <Pie
          data={parts}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={size / 2 - 17}
          outerRadius={size / 2}
          startAngle={90}
          endAngle={-270}
          stroke="none"
          isAnimationActive={false}
        >
          {parts.map((part) => (
            <Cell key={part.id} fill={part.color} />
          ))}
        </Pie>
      </PieChart>

      {/** Over the hole. Pointer events off so it never eats a hover. */}
      <span className="pointer-events-none relative grid place-items-center text-center">
        {children}
      </span>
    </span>
  )
}
