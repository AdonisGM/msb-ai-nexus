/** The three windows both dashboards are read through.
 *
 *  Resolved here rather than by the server, on purpose: the screen knows which
 *  quarter it is showing and sends dates, so a server in another timezone
 *  cannot decide that "quý này" means something else. It also means a filter
 *  a person chose is visible in the URL of the request, which is the first
 *  thing anybody checks when a figure looks wrong. */

export type PeriodId = 'm' | 'q' | 'y'

export type Period = {
  id: PeriodId
  label: string
  /** The range, inclusive both ends, `YYYY-MM-DD`. */
  from: string
  to: string
  /** The last day of the window itself, which `to` deliberately is not.
   *
   *  Every figure on the dashboard reads to today, so `to` is today. A
   *  forecast is the one thing that needs the other date — projecting to the
   *  end of the quarter is the whole question — and computing it a second
   *  time at the call site is how the two come to disagree about February. */
  end: string
  note: string
  /** Days left until the window closes. Zero once it has. */
  daysLeft: number
}

const MONTHS = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
]

function iso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dm(value: string): string {
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}

/** Every window runs to today rather than to its own end.
 *
 *  A quarter's figures read to date, not to the thirtieth of September — a
 *  conversion rate against a full quarter's leads while only half the quarter
 *  has happened is a rate that climbs by itself and tells nobody anything. */
export function resolvePeriod(id: PeriodId, now = new Date()): Period {
  const today = iso(now)

  if (id === 'm') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return {
      id,
      label: MONTHS[now.getMonth()],
      from: iso(start),
      to: today,
      end: iso(end),
      note: `từ ${dm(iso(start))} đến ${dm(today)}/${now.getFullYear()}`,
      daysLeft: daysBetween(now, end),
    }
  }

  if (id === 'q') {
    const quarter = Math.floor(now.getMonth() / 3)
    const start = new Date(now.getFullYear(), quarter * 3, 1)
    const end = new Date(now.getFullYear(), quarter * 3 + 3, 0)
    return {
      id,
      label: `Quý ${quarter + 1}`,
      from: iso(start),
      to: today,
      end: iso(end),
      note: `từ ${dm(iso(start))} đến ${dm(today)}/${now.getFullYear()}`,
      daysLeft: daysBetween(now, end),
    }
  }

  const start = new Date(now.getFullYear(), 0, 1)
  const end = new Date(now.getFullYear(), 11, 31)
  return {
    id,
    label: `Năm ${now.getFullYear()}`,
    from: iso(start),
    to: today,
    end: iso(end),
    note: `từ ${dm(iso(start))} đến ${dm(today)}/${now.getFullYear()}`,
    daysLeft: daysBetween(now, end),
  }
}

/** Whole days, counted by calendar date rather than by subtracting timestamps,
 *  so "còn 10 ngày" means the same thing in the morning and at night. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export const PERIODS: PeriodId[] = ['m', 'q', 'y']
