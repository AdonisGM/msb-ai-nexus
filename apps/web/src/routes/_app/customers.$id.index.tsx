import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { customerQuery, type Customer } from '~/api/customers'
import { SignalForm } from '~/components/customer/signal-form'
import { SignalTimeline } from '~/components/customer/signal-timeline'
import { OpportunityForm } from '~/components/opportunity/opportunity-form'
import { OpportunityList } from '~/components/opportunity/opportunity-list'
import { Button, Card, Chip, Mono, cx } from '~/components/ui/primitives'
import { BlockSkeleton, ErrorState } from '~/components/ui/query-state'
import { t } from '~/i18n'
import { ATTRIBUTE_LABELS, SEGMENT_TONE } from '~/lib/customer'
import { daysSince, vnDate } from '~/lib/dates'
import { fmtNum } from '~/lib/format'
import { canEditRecords } from '~/lib/can'

export const Route = createFileRoute('/_app/customers/$id/')({ component: CustomerScreen })

/** One customer, everything about them.
 *
 *  The file sits on the left as standing context — it changes about twice in
 *  a lead's life — and what is actually happening runs down the right: the
 *  leads, then what has been heard about the customer. Somebody opens this
 *  screen to answer "what do I do next about them", and the right column is
 *  the answer while the left is what they need in hand to give it. */
function CustomerScreen() {
  const { id } = Route.useParams()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const query = useQuery(customerQuery(id))

  /** A branch manager reads this file and never writes to it, so every control
   *  that would post is absent rather than present and refused. */
  const canEdit = canEditRecords(user.role)

  const [noting, setNoting] = useState(false)
  const [adding, setAdding] = useState(false)

  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorState
          what="hồ sơ khách hàng"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
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

  const customer = query.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <div className="flex flex-none items-center gap-2">
          {canEdit ? (
            <Link to="/customers/$id/edit" params={{ id: customer.id }}>
              <Button size="md">Sửa thông tin</Button>
            </Link>
          ) : null}
          <Button size="md" onClick={() => void navigate({ to: '/customers' })}>
            Quay lại danh sách
          </Button>
        </div>
      </div>

      <Identity
        customer={customer}
        onQuickNote={canEdit ? () => setNoting(true) : undefined}
        onAddOpportunity={canEdit ? () => setAdding(true) : undefined}
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Profile customer={customer} />
          <Products customer={customer} />
          {customer.note ? (
            <Card>
              <span className="text-[13px] font-medium">{t('customers.note')}</span>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{customer.note}</p>
            </Card>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-[1.45_1_440px] flex-col gap-4">
          <Card>
            <OpportunityList customerId={customer.id} />
          </Card>

          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <span className="text-[13px] font-medium">{t('customers.signals')}</span>
                <p className="mt-0.5 text-[11.5px] text-muted">Theo ngày quan sát</p>
              </div>
              {/** The second way in. The header button is where somebody goes
                *  with a note already in mind; this one is where they end up
                *  after reading the timeline and noticing a gap. */}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setNoting(true)}
                  className="cursor-pointer text-[11.5px] text-muted transition-colors hover:text-ink"
                >
                  {t('signals.add')}
                </button>
              ) : null}
            </div>
            <div className="mt-3">
              <SignalTimeline customerId={customer.id} />
            </div>
          </Card>
        </div>
      </div>

      {/** Not rendered at all for a reader, rather than rendered and never
        *  opened: a form whose save is refused has no business being in the
        *  tree, and this way a future stray `setNoting(true)` cannot surface
        *  one. */}
      {canEdit ? (
        <>
          <SignalForm customerId={customer.id} open={noting} onClose={() => setNoting(false)} />
          <OpportunityForm customerId={customer.id} open={adding} onClose={() => setAdding(false)} />
        </>
      ) : null}
    </div>
  )
}

/** Who they are and the four figures, in one card.
 *
 *  Together rather than in two, because the figures only mean anything about
 *  a named customer — a strip of tiles floating above a heading reads as the
 *  page's numbers rather than as theirs. */
function Identity({
  customer,
  onQuickNote,
  onAddOpportunity,
}: {
  customer: Customer
  /** Absent for a role that only reads. */
  onQuickNote?: () => void
  onAddOpportunity?: () => void
}) {
  const { leads } = customer
  const decided = leads.won + leads.lost
  const silent = daysSince(customer.lastSignalAt)

  const tiles = [
    {
      label: 'Doanh thu, đồng',
      value: customer.revenue === null ? 'chưa có' : fmtNum(customer.revenue),
      /** No caption. The design's read "Luỹ kế tới hiện tại", and nothing
        *  backs it: the column is a bare figure a salesperson typed, with no
        *  period and no as-at date anywhere in the schema. A caption that
        *  invents one is the kind of thing nobody catches until the number has
        *  been pasted into a report. */
      note: '',
    },
    {
      label: 'Cơ hội đang mở',
      value: String(leads.open + leads.untouched),
      note: `${leads.untouched} chưa ai gọi`,
    },
    {
      label: 'Tỷ lệ chốt',
      value: decided > 0 ? `${Math.round((leads.won / decided) * 100)}%` : '—',
      note: `${leads.won} thành công, ${leads.lost} thất bại`,
    },
    {
      label: 'Tín hiệu cuối',
      value: silent === null ? 'chưa có' : silent === 0 ? 'hôm nay' : `${silent} ngày`,
      /** The only tile that can be bad news on its own. A customer nobody has
        *  heard anything about is precisely what a team lead chases, so it
        *  goes red rather than dim. */
      note: silent === null ? 'Chưa bao giờ có tin' : vnDate(customer.lastSignalAt),
      /** Red only where the design puts it: never heard from at all. The
        *  thirty-day rule that used to be here was mine, and a threshold
        *  nobody agreed reads on screen as a rule that was broken. */
      alarm: silent === null,
    },
  ]

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4">
        <div className="mr-auto flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[19px] font-semibold tracking-tight">{customer.name}</h1>
            <Chip tone={SEGMENT_TONE[customer.segment]}>{t(`segment.${customer.segment}`)}</Chip>
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
            <Mono>{customer.code}</Mono>
            {customer.relationStage ? <span>{customer.relationStage}</span> : null}
            <span>·</span>
            <span>Phụ trách {customer.ownerName}</span>
          </div>
        </div>

        {onQuickNote && onAddOpportunity ? (
          <div className="flex flex-none items-center gap-2">
            <Button size="md" onClick={onQuickNote}>
              Ghi nhận tương tác
            </Button>
            <Button size="md" variant="primary" onClick={onAddOpportunity}>
              {t('opportunities.add')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="flex flex-col gap-1 rounded-[11px] border border-line bg-raised px-3.5 py-3"
          >
            <span className="text-[11px] text-muted">{tile.label}</span>
            <span
              className={cx(
                'num text-[19px] leading-none font-medium',
                tile.alarm && 'text-danger',
              )}
            >
              {tile.value}
            </span>
            {/** Rendered empty rather than skipped, so a tile with nothing
              *  true to say still lines up with the three beside it. */}
            <span className="min-h-[15px] text-[11px] text-muted">{tile.note}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Profile({ customer }: { customer: Customer }) {
  return (
    <Card>
      <span className="text-[13px] font-medium">Hồ sơ khách hàng</span>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[11.5px] text-muted">Người liên hệ</span>
        <span className="text-[12.5px]">{customer.contactName ?? 'chưa có'}</span>
        {customer.contactPhone ? (
          <span className="num text-[12.5px] text-ink2">{customer.contactPhone}</span>
        ) : null}
      </div>

      <Attributes attributes={customer.attributes} />

      <div className="mt-1 flex items-center gap-2.5 border-t border-line pt-2.5 text-[11px] text-muted">
        <span>Tạo {vnDate(customer.createdAt)}</span>
        <span>·</span>
        <span>Cập nhật {vnDate(customer.updatedAt)}</span>
      </div>
    </Card>
  )
}

/** The open attribute map, as label and value joined by a rule.
 *
 *  A leader rather than two columns because the keys are free text and vary
 *  wildly in length — a fixed label column would either wrap the long ones or
 *  strand the short ones, and neither reads as a list of facts.
 *
 *  A key nobody has written a label for still renders, under its own name. The
 *  whole point of `attributes` is that adding a field needs no migration, and
 *  a screen that hid the unlabelled ones would quietly undo that. */
function Attributes({ attributes }: { attributes: Record<string, unknown> }) {
  const entries = Object.entries(attributes).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  )

  if (entries.length === 0) {
    return <p className="mt-3 text-[12px] text-muted">Chưa có thuộc tính nào.</p>
  }

  return (
    <div className="mt-3 flex flex-col gap-[7px]">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-3">
          <span className="max-w-[52%] flex-none text-[11.5px] text-muted">
            {ATTRIBUTE_LABELS[key] ?? key}
          </span>
          <span className="h-px min-w-2 flex-1 bg-line" />
          <span className="num shrink text-right text-[12px] text-ink2">
            {typeof value === 'number' ? fmtNum(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function Products({ customer }: { customer: Customer }) {
  return (
    <Card>
      <span className="text-[13px] font-medium">{t('customers.products')}</span>
      {customer.currentProducts.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted">{t('customers.noProducts')}</p>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {customer.currentProducts.map((product) => (
            <Chip key={product} tone={{ fg: 'var(--ink2)', bg: 'var(--sunken)' }}>
              {product}
            </Chip>
          ))}
        </div>
      )}
    </Card>
  )
}

function BackLink() {
  return (
    <Link
      to="/customers"
      className="flex w-fit items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft size={14} />
      {t('nav.customers')}
    </Link>
  )
}
