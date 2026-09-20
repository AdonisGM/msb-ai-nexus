import { useQuery } from '@tanstack/react-query'
import { signalsQuery, type Signal } from '~/api/signals'
import { Caption, Chip, cx } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'
import { t, tCode } from '~/i18n'
import { vnDate } from '~/lib/dates'

/** What was observed about a customer, newest first.
 *
 *  Ordered by when it was seen rather than when it was typed up, so a Friday
 *  meeting written up on Monday still sits in the right place. */
export function SignalTimeline({ customerId }: { customerId: string }) {
  const query = useQuery(signalsQuery(customerId))

  if (query.isPending) return <BlockSkeleton rows={3} />

  if (query.isError) {
    return <p className="text-[12.5px] text-danger">Không đọc được dòng tín hiệu</p>
  }

  if (query.data.length === 0) {
    return <p className="text-[12.5px] text-muted">{t('signals.empty')}</p>
  }

  return (
    <ol className="flex flex-col">
      {query.data.map((signal, index) => (
        <SignalRow key={signal.id} signal={signal} last={index === query.data.length - 1} />
      ))}
    </ol>
  )
}

function SignalRow({ signal, last }: { signal: Signal; last: boolean }) {
  return (
    <li className="flex gap-3">
      {/** A dot on a line down the left, which is what makes a list of dates
        *  read as a sequence rather than as rows. The line stops at the last
        *  one so it does not trail into nothing. */}
      <span className="relative flex w-3 flex-none justify-center pt-1.5">
        <span className="z-[1] size-1.5 rounded-full bg-ink2" />
        {!last ? <span className="absolute top-3 bottom-0 w-px bg-line" /> : null}
      </span>

      <div className={cx('min-w-0 flex-1', last ? 'pb-0' : 'pb-4')}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={{ fg: 'var(--ink2)', bg: 'var(--sunken)' }}>
            {tCode('signal', signal.type, signal.type)}
          </Chip>
          <Caption>{vnDate(signal.observedAt)}</Caption>
          {/** Who put it there. A name where a person did, the source alone
            *  where the system or the model did — inventing an author for a
            *  machine-written row is exactly the confusion the two-colour
            *  split elsewhere exists to prevent. */}
          <Caption>
            ·{' '}
            {signal.source === 'sale'
              ? `Sale ghi${signal.authorName ? `, ${signal.authorName}` : ''}`
              : signal.source === 'ai'
                ? 'Máy đề xuất'
                : 'Hệ thống ghi'}
          </Caption>
        </div>

        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{signal.content}</p>

        {/** The salesperson's own sentence, kept as they typed it. This is the
          *  evidence behind anything inferred from it later — it can be put
          *  side by side with what the model made of it. */}
        {signal.rawNote ? (
          <blockquote className="mt-2 border-l-2 border-line2 pl-3 text-[12px] leading-relaxed text-muted italic">
            {signal.rawNote}
          </blockquote>
        ) : null}
      </div>
    </li>
  )
}
