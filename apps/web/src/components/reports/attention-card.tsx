import { Link } from '@tanstack/react-router'
import { pct, type Attention, type AttentionReason, type AttentionRow } from '~/api/reports'
import { Card, Chip } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'
import { t, tCode } from '~/i18n'
import { daysSince, dmDate } from '~/lib/dates'
import { fmtMoney, fmtNum } from '~/lib/format'

/** The handful of open deals worth a branch manager's own week.
 *
 *  The brief asks which 20% of opportunities need them personally. Two
 *  decisions make this that list rather than another queue:
 *
 *  It is **ordered by value**, not by lateness. A team lead chases the oldest;
 *  a branch manager has time for a few deals and should spend it on the ones
 *  that move the number.
 *
 *  And it **says what it is not showing**. Ten rows out of forty, covering
 *  62% of the stuck value, is a different message from ten rows — and a card
 *  that leaves that out lets a manager believe they have seen the problem. */
export function AttentionCard({ data, loading }: { data?: Attention; loading: boolean }) {
  if (loading || !data) {
    return (
      <Card className="w-full">
        <Head />
        <BlockSkeleton rows={4} />
      </Card>
    )
  }

  return (
    <Card className="w-full">
      <Head
        note={
          data.total === 0
            ? undefined
            : `${fmtNum(data.total)} cơ hội, ${fmtMoney(data.value)} — ${pct(data.shareBps)} sổ đang mở`
        }
      />

      {data.total === 0 ? (
        <p className="mt-3 text-[12px] text-muted">
          Không có cơ hội nào quá hạn hoặc bị bỏ quên. Sổ đang mở {fmtNum(data.openTotal)} cơ
          hội.
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {data.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>

          {/** Never let the rows stand for the whole problem. */}
          {data.rows.length < data.total && (
            <p className="mt-2 text-[11.5px] text-muted">
              {`${fmtNum(data.rows.length)} trong ${fmtNum(data.total)} cơ hội, chiếm ${pct(
                data.shownShareBps,
              )} giá trị đang kẹt.`}{' '}
              <Link
                to="/opportunities"
                search={{ outcome: 'open', sort: 'value' }}
                className="underline underline-offset-2 hover:text-ink"
              >
                Xem hết
              </Link>
            </p>
          )}
        </>
      )}
    </Card>
  )
}

function Row({ row }: { row: AttentionRow }) {
  const silent = daysSince(row.lastTouchAt)

  return (
    <li className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-2 first:pt-1">
      <Link
        to="/opportunities/$id"
        params={{ id: row.id }}
        className="truncate text-[12.5px] font-medium hover:underline"
      >
        {row.customerName}
      </Link>

      <span className="num text-[12px] font-semibold">{fmtMoney(row.value)}</span>

      {row.reasons.map((reason) => (
        <Chip key={reason} tone={REASON[reason].tone}>
          {reason === 'overdue' && row.dueDate
            ? `Quá hạn ${dmDate(row.dueDate)}`
            : reason === 'stale' && silent !== null
              ? `Im lặng ${silent} ngày`
              : REASON[reason].label}
        </Chip>
      ))}

      <span className="ml-auto flex items-center gap-2 text-[11px] text-muted">
        {row.blockerCode && <span>{tCode('blocker', row.blockerCode, row.blockerCode)}</span>}
        <span>{t(`product.${row.product as 'card'}`)}</span>
        <span className="truncate">{row.ownerName}</span>
      </span>
    </li>
  )
}

function Head({ note }: { note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[13px] font-medium">Cơ hội cần can thiệp</h2>
      <span className="text-[11.5px] text-muted">{note ?? 'quá hạn hoặc bị bỏ quên'}</span>
    </div>
  )
}

/** `untouched` never appears alone — a lead nobody has called is only on this
 *  list once it has also gone silent — but it is worth saying when it does,
 *  because "nobody ever called" is a different conversation from "the
 *  conversation stopped". */
const REASON: Record<AttentionReason, { label: string; tone: { fg: string; bg: string } }> = {
  overdue: { label: 'Quá hạn', tone: { fg: 'var(--c-danger)', bg: 'var(--danger-soft)' } },
  stale: { label: 'Im lặng', tone: { fg: 'var(--c-warn)', bg: 'var(--warn-soft)' } },
  untouched: { label: 'Chưa ai gọi', tone: { fg: 'var(--c-neutral)', bg: 'var(--sunken)' } },
}
