/** Date ranges the toolbar filters by.
 *
 *  Lifted from the project the design system comes from, minus the accounting
 *  periods it needed for budgets. What a branch actually asks is "what has
 *  moved lately" and "how is the quarter going", so the presets stop there. */

export type DatePreset = 'all' | '30' | '90' | 'quarter' | 'year'
export type DateFilter = { preset: DatePreset; from: string; to: string }

export const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'all', label: 'Mọi thời gian' },
  { id: '30', label: '30 ngày' },
  { id: '90', label: '90 ngày' },
  { id: 'quarter', label: 'Quý này' },
  { id: 'year', label: 'Năm nay' },
]

export const EMPTY_FILTER: DateFilter = { preset: 'all', from: '', to: '' }

function iso(date: Date) {
  return date.toISOString().slice(0, 10)
}

/** Turns a preset into the two dates the server is asked for.
 *
 *  A typed range always wins: once someone has picked their own dates the
 *  preset is only a label, and recomputing over the top of them is the kind of
 *  thing that makes a filter feel broken. */
export function resolveRange(filter: DateFilter): { from: string; to: string } {
  if (filter.from || filter.to) return { from: filter.from, to: filter.to }

  const now = new Date()
  const today = iso(now)

  switch (filter.preset) {
    case 'all':
      return { from: '', to: '' }
    case '30':
    case '90': {
      const back = new Date(now)
      back.setDate(back.getDate() - Number(filter.preset))
      return { from: iso(back), to: today }
    }
    case 'quarter': {
      const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      return { from: iso(start), to: today }
    }
    case 'year':
      return { from: `${now.getFullYear()}-01-01`, to: today }
  }
}

/** The quarter label targets are stored under, e.g. `2026-Q3`. */
export function currentPeriod(at = new Date()): string {
  return `${at.getFullYear()}-Q${Math.floor(at.getMonth() / 3) + 1}`
}

/** What the filter is showing, in words. Read from the same place as the range
 *  sent to the server, so the caption never disagrees with the rows below it. */
export function rangeText(filter: DateFilter): string {
  if (filter.from || filter.to) {
    if (filter.from && filter.to) return `từ ${vnDate(filter.from)} đến ${vnDate(filter.to)}`
    if (filter.from) return `từ ${vnDate(filter.from)}`
    return `đến ${vnDate(filter.to)}`
  }

  const now = new Date()
  switch (filter.preset) {
    case 'all':
      return 'mọi thời gian'
    case '30':
      return '30 ngày gần đây'
    case '90':
      return '90 ngày gần đây'
    case 'quarter':
      return `quý ${Math.floor(now.getMonth() / 3) + 1}.${now.getFullYear()}`
    case 'year':
      return `năm ${now.getFullYear()}`
  }
}

export function vnDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Days until a deadline; negative once it has passed.
 *
 *  Compared as whole days in local time rather than by subtracting timestamps:
 *  a deadline is a day, and an hours-based comparison would flip "overdue" at
 *  whatever moment the page happened to be opened. */
export function daysUntil(due: string | null | undefined, now = new Date()): number | null {
  if (!due) return null
  const target = new Date(due)
  if (Number.isNaN(target.getTime())) return null

  const a = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / 86_400_000)
}

/** How many whole days ago something happened, or null if it never did.
 *
 *  The mirror of `daysUntil`, and compared the same way — by calendar day
 *  rather than by subtracting timestamps. "3 ngày trước" has to mean the same
 *  thing at nine in the morning and at eleven at night, or a list re-sorts
 *  itself over lunch.
 *
 *  Null is not zero and must not be rendered as one: "chưa bao giờ có tin" is
 *  a louder version of the same worry as "ba tuần không có tin". */
export function daysSince(at: string | Date | null | undefined, now = new Date()): number | null {
  const days = daysUntil(typeof at === 'string' || !at ? at : at.toISOString(), now)
  return days === null ? null : Math.max(0, -days)
}

/** Day and month only, `22.09`.
 *
 *  For table columns where the year is noise: everything on a working list is
 *  this year, and four extra characters per row across seven columns is what
 *  turns a scannable table into a wall. The full date stays on the detail
 *  screen, where somebody is reading one record rather than comparing twenty. */
export function dmDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Date and time, `20.09 08:41`.
 *
 *  For a column where the day alone is not enough — "last signed in" on an
 *  account somebody may have used an hour ago. No year, same reason as
 *  `dmDate`: everything on a working screen is this year. */
export function vnDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
