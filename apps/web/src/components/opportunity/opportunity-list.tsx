import { useQuery } from '@tanstack/react-query'
import { opportunitiesQuery, type Opportunity } from '~/api/opportunities'
import { ActionBar } from '~/components/opportunity/action-bar'
import { Chip, Money, cx } from '~/components/ui/primitives'
import { BlockSkeleton } from '~/components/ui/query-state'
import { t, tCode } from '~/i18n'
import { daysSince, daysUntil, vnDate } from '~/lib/dates'
import { fmtMoney } from '~/lib/format'

/** Every lead on one customer, each open on the page.
 *
 *  Not a table with a row to expand. A customer has a handful of leads, not a
 *  hundred, and what somebody needs from this block is never "compare the
 *  sizes" — it is "what is happening with each of these, and what do I press".
 *  Hiding that behind a chevron adds a click to every single one.
 *
 *  Each block only shows the lines it has: a lead with no blocker draws no
 *  blocker row, rather than an empty label. */
export function OpportunityList({ customerId }: { customerId: string }) {
  const query = useQuery(opportunitiesQuery({ customerId, pageSize: 50 }))

  if (query.isPending) return <BlockSkeleton rows={4} />
  if (query.isError) {
    return <p className="text-[12.5px] text-danger">{t('opportunities.loadFailed')}</p>
  }

  const rows = query.data.rows
  const open = rows.filter((row) => row.outcome === 'open').length
  const untouched = rows.filter((row) => row.contactedAt === null).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="text-[13px] font-medium">{t('nav.opportunities')}</h2>
        <span className="text-[11.5px] text-muted">
          {rows.length} cơ hội, {open} đang mở, {untouched} chưa ai gọi
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line2 px-4 py-10 text-center">
          <span className="text-[13px]">Chưa có cơ hội nào</span>
          <span className="text-[12px] text-muted">Tạo cơ hội để bắt đầu phễu.</span>
        </div>
      ) : (
        rows.map((deal) => <Block key={deal.id} deal={deal} />)
      )}
    </div>
  )
}

function Block({ deal }: { deal: Opportunity }) {
  const silent = daysSince(deal.lastTouchAt)
  /** Two weeks of nothing on a live lead is the number a team lead chases, so
   *  it is said in red rather than left for somebody to work out. */
  const cold = deal.outcome === 'open' && silent !== null && silent >= 14

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-raised px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{t(`product.${deal.product}`)}</span>
        <span className="font-mono text-[11px] text-muted">{deal.code}</span>
        <Chip tone={STAGE_TONE[deal.stage]}>{t(`stage.${deal.stage}`)}</Chip>
        {deal.outcome !== 'open' ? (
          <Chip tone={OUTCOME_TONE[deal.outcome]}>{t(`outcome.${deal.outcome}`)}</Chip>
        ) : null}
        {/** The one badge that is about the model rather than the deal. It is
          *  the before-and-after axis of the whole entry, so it earns a mark
          *  on the lead itself. */}
        {deal.createdVia === 'ai' ? (
          <Chip tone={{ fg: 'var(--pending)', bg: 'var(--pending-soft)' }}>Máy đề xuất</Chip>
        ) : null}
        <span className="ml-auto">
          <Money value={fmtMoney(deal.value)} size="md" />
        </span>
      </div>

      <p className="text-[12.5px] text-ink2">{deal.need}</p>

      {deal.nextAction ? (
        <Line label="Việc tiếp theo">
          {deal.nextAction}
          <Due deal={deal} />
        </Line>
      ) : null}

      {deal.blockerCode ? (
        <Line label="Vướng ở">
          <span className="text-[var(--warn)]">{tCode('blocker', deal.blockerCode)}</span>
          {deal.blockerNote ? <span className="text-muted"> · {deal.blockerNote}</span> : null}
        </Line>
      ) : null}

      {deal.outcomeReason ? <Line label="Lý do chốt">{deal.outcomeReason}</Line> : null}

      {deal.products.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {deal.products.map((sold) => (
            <span
              key={sold.id}
              className="rounded-[5px] bg-success-soft px-2 py-[3px] text-[10.5px] text-[var(--success)]"
            >
              Bán được {t(`product.${sold.product}`)}
              {sold.amount > 0 ? `, ${fmtMoney(sold.amount)}` : ''}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {deal.missingInfo.map((item) => (
          <span
            key={item}
            className="rounded-[4px] bg-warn-soft px-2 py-[3px] text-[10.5px] text-[var(--warn)]"
          >
            Thiếu {item}
          </span>
        ))}
        <span className={cx('text-[11px]', cold ? 'text-danger' : 'text-muted')}>
          {silent === null
            ? 'chưa có cập nhật'
            : silent === 0
              ? 'cập nhật hôm nay'
              : `${silent} ngày chưa có cập nhật gì`}
        </span>
      </div>

      {deal.outcome !== 'open' ? <SignLine deal={deal} /> : null}

      <div className="pt-0.5">
        <ActionBar deal={deal} />
      </div>
    </div>
  )
}

/** The reconciliation, drawn as two points on one line.
 *
 *  Both halves show even when only the first has happened, because the gap
 *  between them is the information: "Hải chốt 12.09, chưa ai đối chiếu" is a
 *  different state from a lead nobody has finished. */
function SignLine({ deal }: { deal: Opportunity }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-2.5 text-[11.5px]">
      <span className="flex items-center gap-1.5">
        <span className="size-2 flex-none rounded-full bg-ink2" />
        <span className="text-muted">
          {deal.ownerName} chốt {deal.closedAt ? vnDate(deal.closedAt) : ''}
        </span>
      </span>

      <span className="h-px w-5 flex-none bg-line2" />

      {deal.confirmedAt ? (
        <span className="flex items-center gap-1.5">
          <span className="size-2 flex-none rounded-full bg-[var(--success)]" />
          <span className="text-muted">
            {deal.confirmedByName} đã đối chiếu {vnDate(deal.confirmedAt)}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="size-2 flex-none rounded-full bg-[var(--warn)]" />
          <span className="font-medium text-[var(--warn)]">
            Đang chờ {deal.pendingConfirmName ?? 'trưởng nhóm'} xác nhận
          </span>
        </span>
      )}

      {deal.confirmNote ? <span className="w-full text-muted">{deal.confirmNote}</span> : null}
    </div>
  )
}

/** The deadline, and only while it still means something. A lead closed after
 *  its date was late, not overdue — leaving it red puts work on the screen
 *  that no longer exists. */
function Due({ deal }: { deal: Opportunity }) {
  if (deal.outcome !== 'open' || !deal.dueDate) return null

  const days = daysUntil(deal.dueDate)
  const late = days !== null && days < 0

  return (
    <span className={cx('ml-2 text-[11px]', late ? 'text-danger' : 'text-muted')}>
      {late ? 'Quá hạn' : 'Hạn'} {vnDate(deal.dueDate)}
    </span>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-wrap items-baseline gap-2 text-[12px]">
      <span className="w-[86px] flex-none text-[11px] text-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </span>
  )
}

const STAGE_TONE = {
  new: { fg: 'var(--muted)', bg: 'var(--sunken)' },
  contacted: { fg: 'var(--info)', bg: 'var(--info-soft)' },
  advised: { fg: 'var(--info)', bg: 'var(--info-soft)' },
} as const

const OUTCOME_TONE = {
  won: { fg: 'var(--success)', bg: 'var(--success-soft)' },
  lost: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  open: { fg: 'var(--muted)', bg: 'var(--sunken)' },
} as const
