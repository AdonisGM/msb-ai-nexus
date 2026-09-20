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
 *  Drawn with one `conic-gradient` rather than four SVG arcs: the maths is the
 *  running total either way, and a gradient cannot leave the hairline gaps
 *  between adjacent arcs that make a full ring look like it is missing a
 *  slice. */
export function LeadDonut({
  leads,
  size = 132,
  children,
}: {
  leads: LeadSummary
  size?: number
  children?: React.ReactNode
}) {
  const stops: string[] = []
  let at = 0

  for (const bucket of BUCKETS) {
    const share = leads.total > 0 ? (leads[bucket.id] / leads.total) * 100 : 0
    if (share > 0) {
      stops.push(`${bucket.color} ${at}% ${at + share}%`)
      at += share
    }
  }

  /** Nothing to show is drawn as an empty ring, not as an absent one, so the
   *  card keeps its shape while a filter is being narrowed down to nothing. */
  const ring =
    stops.length > 0
      ? `conic-gradient(from -90deg, ${stops.join(', ')})`
      : 'conic-gradient(var(--sunken) 0% 100%)'

  return (
    <span
      className="relative grid flex-none place-items-center rounded-full"
      style={{ width: size, height: size, background: ring }}
    >
      <span
        className="grid place-items-center rounded-full bg-surface text-center"
        style={{ width: size - 34, height: size - 34 }}
      >
        {children}
      </span>
    </span>
  )
}
