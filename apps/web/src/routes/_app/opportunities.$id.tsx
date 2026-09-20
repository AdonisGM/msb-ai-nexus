import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import {
  historyQuery,
  opportunityQuery,
  type HistoryEvent,
  type Opportunity,
} from '~/api/opportunities'
import { ActionBar } from '~/components/opportunity/action-bar'
import { Button, Card, Chip, Money, Mono, cx } from '~/components/ui/primitives'
import { BlockSkeleton, ErrorState } from '~/components/ui/query-state'
import { t, tCode } from '~/i18n'
import { daysSince, daysUntil, vnDate } from '~/lib/dates'
import { fmtDuration, fmtMoney, fmtNum } from '~/lib/format'

export const Route = createFileRoute('/_app/opportunities/$id')({ component: OpportunityScreen })

/** One lead, everything that is true about it and everything that has
 *  happened to it.
 *
 *  Two columns: where it stands on the left, how it got there on the right.
 *  The trace is not an audit panel tucked behind a tab — it is the answer to
 *  "why has this taken three weeks", which is the question somebody opens
 *  this screen with. */
function OpportunityScreen() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const query = useQuery(opportunityQuery(id))

  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorState what="cơ hội" error={query.error} onRetry={() => void query.refetch()} />
      </div>
    )
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <BlockSkeleton rows={6} />
      </div>
    )
  }

  const deal = query.data

  return (
    <div className="flex flex-col gap-3.5">
      <BackLink />

      <Card className="px-5 py-[18px]">
        <div className="flex flex-wrap items-start gap-4">
          <div className="mr-auto flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[19px] font-semibold tracking-tight">
                {t(`product.${deal.product}`)}
              </h1>
              <Chip tone={OUTCOME_TONE[deal.outcome]}>{t(`outcome.${deal.outcome}`)}</Chip>
              {deal.createdVia === 'ai' ? (
                <Chip tone={{ fg: 'var(--pending)', bg: 'var(--pending-soft)' }}>
                  Máy đề xuất
                </Chip>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
              <Mono>{deal.code}</Mono>
              <Link
                to="/customers/$id"
                params={{ id: deal.customerId }}
                className="text-ink2 transition-colors hover:text-ink"
              >
                {deal.customerName}
              </Link>
              <Mono>{deal.customerCode}</Mono>
              <span>·</span>
              <span>{deal.source === 'import' ? 'Nhập từ chiến dịch' : 'Sale tự tìm'}</span>
              <span>·</span>
              <span>{deal.ownerName}</span>
            </div>
          </div>

          <div className="flex flex-none flex-col items-end">
            <span className="text-[11px] text-muted">Giá trị kỳ vọng</span>
            <Money value={`${fmtNum(deal.value)} đồng`} size="lg" />
          </div>
        </div>

        <p className="mt-3 text-[13px] text-ink2">{deal.need}</p>

        {deal.products.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {deal.products.map((sold) => (
              <span
                key={sold.id}
                className="rounded-[5px] bg-success-soft px-2 py-[3px] text-[11px] text-[var(--success)]"
              >
                Bán được {t(`product.${sold.product}`)}
                {sold.amount > 0 ? `, ${fmtMoney(sold.amount)}` : ''}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
          <ActionBar deal={deal} />
          <span className="ml-auto">
            <Button size="md" onClick={() => void navigate({ to: '/opportunities' })}>
              Quay lại danh sách
            </Button>
          </span>
        </div>
      </Card>

      <div className="flex flex-wrap items-start gap-3.5">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <Progress deal={deal} />
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <Trace id={deal.id} />
        </div>
      </div>
    </div>
  )
}

/** Where the lead stands, as eight plain facts.
 *
 *  Label and value joined by a rule rather than set in two columns: the values
 *  run from "chưa" to a whole sentence, and a fixed value column would either
 *  wrap the long ones or strand the short ones. */
function Progress({ deal }: { deal: Opportunity }) {
  const silent = daysSince(deal.lastTouchAt)
  const days = deal.dueDate ? daysUntil(deal.dueDate) : null
  const late = deal.outcome === 'open' && days !== null && days < 0

  const lines: Array<[string, React.ReactNode]> = [
    ['Bước phễu', t(`stage.${deal.stage}`)],
    ['Tiếp cận lần đầu', deal.contactedAt ? vnDate(deal.contactedAt) : muted('chưa')],
    ['Đã tư vấn', deal.advisedAt ? vnDate(deal.advisedAt) : muted('chưa')],
    [
      'Động tĩnh cuối',
      silent === null
        ? muted('chưa có')
        : silent === 0
          ? 'hôm nay'
          : `${silent} ngày trước`,
    ],
    ['Việc tiếp theo', deal.nextAction ?? muted('chưa đặt')],
    [
      'Hạn',
      deal.dueDate ? (
        <span className={cx(late && 'text-danger')}>
          {late ? 'Quá hạn ' : ''}
          {vnDate(deal.dueDate)}
        </span>
      ) : (
        muted('chưa đặt')
      ),
    ],
    [
      'Điểm vướng',
      deal.blockerCode ? tCode('blocker', deal.blockerCode) : muted('không'),
    ],
    ['Ghi chú vướng', deal.blockerNote ?? muted('không')],
  ]

  if (deal.outcomeReason) lines.push(['Lý do chốt', deal.outcomeReason])

  return (
    <Card>
      <span className="text-[13px] font-medium">Tình trạng xử lý</span>

      <div className="mt-3 flex flex-col gap-[7px]">
        {lines.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-3">
            <span className="max-w-[52%] flex-none text-[11.5px] text-muted">{label}</span>
            <span className="h-px min-w-2 flex-1 bg-line" />
            <span className="shrink text-right text-[12px] text-ink2">{value}</span>
          </div>
        ))}
      </div>

      {deal.missingInfo.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          {deal.missingInfo.map((item) => (
            <span
              key={item}
              className="rounded-[4px] bg-warn-soft px-2 py-[3px] text-[11px] text-[var(--warn)]"
            >
              Thiếu {item}
            </span>
          ))}
        </div>
      ) : null}

      {deal.outcome !== 'open' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[11.5px]">
          <span className="size-2 flex-none rounded-full bg-ink2" />
          <span className="text-muted">
            {deal.ownerName} chốt {deal.closedAt ? vnDate(deal.closedAt) : ''}
          </span>
          <span className="h-px w-5 flex-none bg-line2" />
          {deal.confirmedAt ? (
            <>
              <span className="size-2 flex-none rounded-full bg-[var(--success)]" />
              <span className="text-muted">
                {deal.confirmedByName} đã đối chiếu {vnDate(deal.confirmedAt)}
              </span>
            </>
          ) : (
            <>
              <span className="size-2 flex-none rounded-full bg-[var(--warn)]" />
              <span className="font-medium text-[var(--warn)]">
                Đang chờ {deal.pendingConfirmName ?? 'trưởng nhóm'} xác nhận
              </span>
            </>
          )}
          {deal.confirmNote ? <span className="w-full text-muted">{deal.confirmNote}</span> : null}
        </div>
      ) : null}
    </Card>
  )
}

/** Everything that has happened, oldest first, with how long each step waited.
 *
 *  `heldMs` is the column that makes this worth looking at rather than a list
 *  of dates: "bốn ngày sau bước trước" is the sentence somebody is actually
 *  after when they open a lead that has taken three weeks. */
function Trace({ id }: { id: string }) {
  const query = useQuery(historyQuery(id))

  return (
    <Card>
      <span className="text-[13px] font-medium">Vết xử lý</span>

      {query.isPending ? (
        <div className="mt-3">
          <BlockSkeleton rows={4} />
        </div>
      ) : query.isError || query.data.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted">Chưa có vết xử lý nào.</p>
      ) : (
        <div className="mt-3 flex flex-col">
          {query.data.map((event, index) => (
            <Step key={event.id} event={event} last={index === query.data.length - 1} />
          ))}
        </div>
      )}
    </Card>
  )
}

function Step({ event, last }: { event: HistoryEvent; last: boolean }) {
  const changes = Object.entries(event.changes ?? {})

  return (
    <div className="flex gap-3">
      <div className="flex flex-none flex-col items-center pt-1">
        <span
          className="size-[9px] rounded-full"
          style={{ background: HISTORY_COLOR[event.kind] }}
        />
        {!last ? <span className="w-px flex-1 bg-line" /> : null}
      </div>

      <div className={cx('min-w-0 flex-1', last ? 'pb-0' : 'pb-4')}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[12px] font-semibold">{t(`history.${event.kind}`)}</span>
          <span className="text-[11px] text-muted">{vnDate(event.createdAt)}</span>
          <span className="text-[11px] text-muted">
            {event.actorName}, {tCode('role', event.actorRole, event.actorRole)}
          </span>
        </div>

        {event.reason ? (
          <p className="mt-1 text-[12px] leading-relaxed text-ink2">{event.reason}</p>
        ) : null}

        {changes.length > 0 ? (
          <div className="mt-1 flex flex-col gap-0.5">
            {changes.map(([field, pair]) => (
              <span key={field} className="text-[11px] text-muted">
                {field}: {show(pair[0])} → <span className="text-ink2">{show(pair[1])}</span>
              </span>
            ))}
          </div>
        ) : null}

        {/** Null on the first event and only there — nothing to measure from. */}
        {event.heldMs !== null ? (
          <span className="mt-1 block text-[11px] text-muted">
            {fmtDuration(event.heldMs)} sau bước trước
          </span>
        ) : null}
      </div>
    </div>
  )
}

const HISTORY_COLOR: Record<HistoryEvent['kind'], string> = {
  created: 'var(--muted)',
  assigned: 'var(--c-pending)',
  contacted: 'var(--c-info)',
  advised: 'var(--c-info)',
  won: 'var(--c-success)',
  lost: 'var(--c-danger)',
  reopened: 'var(--c-warn)',
  confirmed: 'var(--c-success)',
  edited: 'var(--muted)',
}

const OUTCOME_TONE = {
  open: { fg: 'var(--info)', bg: 'var(--info-soft)' },
  won: { fg: 'var(--success)', bg: 'var(--success-soft)' },
  lost: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
} as const

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return fmtNum(value)
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function muted(text: string) {
  return <span className="text-muted">{text}</span>
}

function BackLink() {
  return (
    <Link
      to="/opportunities"
      className="flex w-fit items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft size={14} />
      {t('nav.opportunities')}
    </Link>
  )
}
