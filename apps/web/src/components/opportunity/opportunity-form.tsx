import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BLOCKER_CODES,
  PRODUCTS,
  createOpportunity,
  updateOpportunity,
  type Opportunity,
  type Product,
} from '~/api/opportunities'
import { inputBase } from '~/components/ui/form-controls'
import { Modal } from '~/components/ui/modal'
import { Button, cx } from '~/components/ui/primitives'
import { t } from '~/i18n'
import { useWriteError } from '~/lib/use-write-error'
import { fmtMoney } from '~/lib/format'

/** Opening a new lead on a customer.
 *
 *  Kept to what a salesperson knows coming out of a meeting: what they are
 *  selling, why, how much and by when. Everything the lead will collect as it
 *  moves — where it got stuck, what is missing — arrives later, and asking for
 *  it up front just produces guesses.
 *
 *  There is no funnel step to choose. Every lead starts untouched however it
 *  arrived, because typing one in is not the same as having called it, and a
 *  form that let somebody claim otherwise would put a fiction straight into
 *  the one figure the branch is judged on. */
export function OpportunityForm({
  customerId,
  editing,
  open,
  onClose,
}: {
  /** Which customer a new lead hangs off. Ignored when editing — a lead never
   *  changes hands between customers. */
  customerId?: string
  /** Present when correcting a lead rather than opening one. */
  editing?: Opportunity
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const onWriteError = useWriteError()

  const [product, setProduct] = useState<Product>('loan')
  const [need, setNeed] = useState('')
  const [value, setValue] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [blockerCode, setBlockerCode] = useState('')
  const [blockerNote, setBlockerNote] = useState('')
  const [missingInfo, setMissingInfo] = useState('')
  const [reason, setReason] = useState('')

  const amount = Number(value.replace(/[^0-9]/g, '')) || 0

  function reset() {
    setProduct('loan')
    setNeed('')
    setValue('')
    setDueDate('')
    setNextAction('')
    setBlockerCode('')
    setBlockerNote('')
    setMissingInfo('')
    setReason('')
  }

  /** Refilled each time it opens, so correcting one lead never shows another's
   *  values for a frame. */
  useEffect(() => {
    if (!open) return
    if (!editing) {
      reset()
      return
    }
    setProduct(editing.product)
    setNeed(editing.need)
    setValue(String(editing.value))
    setDueDate(editing.dueDate ?? '')
    setNextAction(editing.nextAction ?? '')
    setBlockerCode(editing.blockerCode ?? '')
    setBlockerNote(editing.blockerNote ?? '')
    setMissingInfo(editing.missingInfo.join(', '))
    setReason('')
  }, [open, editing])

  const save = useMutation({
    mutationFn: () => {
      const shared = {
        product,
        need: need.trim(),
        value: amount,
        dueDate: dueDate || undefined,
        nextAction: nextAction.trim() || undefined,
        blockerCode: blockerCode || undefined,
        blockerNote: blockerNote.trim() || undefined,
        missingInfo: missingInfo
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }

      if (editing) {
        return updateOpportunity(editing.id, { ...shared, reason: reason.trim() || undefined })
      }
      return createOpportunity({ ...shared, customerId: customerId! })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
      ])
      toast.success(editing ? 'Đã lưu thay đổi' : t('opportunities.created'))
      reset()
      onClose()
    },
    onError: (error) => void onWriteError(error, '/customers'),
  })

  const ready = need.trim().length > 0 && amount > 0 && !save.isPending

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      width={560}
      title={editing ? 'Sửa cơ hội' : t('opportunities.newTitle')}
      subtitle={editing ? editing.code : t('opportunities.newSubtitle')}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="lg" variant="primary" disabled={!ready} onClick={() => save.mutate()}>
            {save.isPending
              ? t('opportunities.creating')
              : editing
                ? 'Lưu thay đổi'
                : t('opportunities.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted">
          {t('field.product')}
          <span className="ml-1 text-[var(--warn)]">*</span>
        </span>
        {/** A closed set, because the branch report is one column per product.
          *  Free text here would put "Thẻ TD" and "Thẻ tín dụng" into two
          *  different columns of the same table. */}
        <div className="flex flex-wrap gap-1.5">
          {PRODUCTS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setProduct(id)}
              className={cx(
                'rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
                id === product
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line2 text-muted hover:text-ink',
              )}
            >
              {t(`product.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <Field label={t('field.need')} required>
        <input
          id="need"
          value={need}
          autoFocus
          onChange={(event) => setNeed(event.target.value)}
          placeholder="Mua căn hộ, cần giải ngân trước hạn hợp đồng"
          className={inputBase}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
        <Field label={`${t('field.value')} (đồng)`} required>
          <input
            id="value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="numeric"
            placeholder="2000000000"
            className={cx(inputBase, 'font-mono')}
          />
          {amount > 0 ? (
            <span className="font-mono text-[11px] text-muted">{fmtMoney(amount)}</span>
          ) : null}
        </Field>

        <Field label={t('field.dueDate')}>
          <input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className={cx(inputBase, 'font-mono')}
          />
        </Field>
      </div>

      <Field label={t('field.nextAction')}>
        <input
          id="nextAction"
          value={nextAction}
          onChange={(event) => setNextAction(event.target.value)}
          placeholder="Gọi lại xác nhận nhu cầu, gửi bảng lãi suất"
          className={inputBase}
        />
      </Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted">
          {t('field.blocker')} · {t('common.optional')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {BLOCKER_CODES.map((id) => (
            <button
              key={id}
              type="button"
              /** Tapping the chosen one again clears it. A lead with nothing in
                *  its way is the normal case, and a picker with no way back to
                *  "none" forces a blocker onto every one of them. */
              onClick={() => setBlockerCode((current) => (current === id ? '' : id))}
              className={cx(
                'rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
                id === blockerCode
                  ? 'border-[var(--warn)] bg-warn-soft text-ink'
                  : 'border-line2 text-muted hover:text-ink',
              )}
            >
              {t(`blocker.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <Field label="Còn thiếu thông tin gì">
        <input
          value={missingInfo}
          onChange={(event) => setMissingInfo(event.target.value)}
          placeholder="Sao kê 12 tháng, chứng thư định giá"
          className={inputBase}
        />
        <span className="text-[11px] text-muted">Phân tách bằng dấu phẩy.</span>
      </Field>

      {editing ? (
        <Field label={`${t('actions.reason')} · ${t('common.optional')}`}>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Khách đổi số tiền cần vay"
            className={inputBase}
          />
          {/** The before and after are recorded whatever happens; this is the
            *  line that says why, and it is the only part a reader of the trail
            *  cannot work out for themselves. */}
          <span className="text-[11px] text-muted">
            Ghi vào vết xử lý, cạnh giá trị trước và sau.
          </span>
        </Field>
      ) : null}

      {blockerCode ? (
        <Field label={t('field.blockerNote')}>
          <input
            id="blockerNote"
            value={blockerNote}
            onChange={(event) => setBlockerNote(event.target.value)}
            placeholder="VCB chào 7,9% năm đầu, khách so sánh"
            className={inputBase}
          />
        </Field>
      ) : null}
    </Modal>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted">
        {label}
        {required ? <span className="ml-1 text-[var(--warn)]">*</span> : null}
      </span>
      {children}
    </label>
  )
}
