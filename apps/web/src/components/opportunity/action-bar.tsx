import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  PRODUCTS,
  actOnOpportunity,
  type ActionName,
  type OfferedAction,
  type Opportunity,
  type Product,
} from '~/api/opportunities'
import { inputBase } from '~/components/ui/form-controls'
import { Modal } from '~/components/ui/modal'
import { Button, cx } from '~/components/ui/primitives'
import { t, tCode } from '~/i18n'
import { fmtMoney } from '~/lib/format'
import { useWriteError } from '~/lib/use-write-error'

/** The moves the signed-in person may make on a lead.
 *
 *  Every button here came from the server with the row. Nothing is worked out
 *  on this side, because permission depends on whether the lead is theirs and
 *  whether they manage its owner — neither of which the screen knows. A screen
 *  that guessed would eventually offer a button the server refuses, and a 403
 *  in front of somebody who did nothing wrong. */
export function ActionBar({ deal }: { deal: Opportunity }) {
  const queryClient = useQueryClient()
  const onWriteError = useWriteError()

  const [asking, setAsking] = useState<OfferedAction | null>(null)
  const [reason, setReason] = useState('')
  const [sold, setSold] = useState<Record<string, string>>({})

  /** Only a win asks what was sold. The branch counts cards, overdrafts and
   *  loans in separate columns, and a win that names none of them lands in
   *  the total and in no column. */
  const needsProducts = asking?.action === 'win'

  const run = useMutation({
    mutationFn: ({ action }: { action: ActionName }) =>
      actOnOpportunity(deal.id, action, {
        reason: reason.trim() || undefined,
        products: needsProducts
          ? Object.entries(sold).map(([product, amount]) => ({
              product: product as Product,
              amount: Number(amount.replace(/\D/g, '')) || 0,
            }))
          : undefined,
      }),
    onSuccess: async (_, { action }) => {
      /** Everything the move touched: the lead, the customer it hangs off,
       *  and the lists it appears in — a win leaves the working queue and
       *  joins the team lead's signing queue in the same instant. */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
      ])
      toast.success(t(`actionDone.${action}`))
      close()
    },
    onError: (error) => void onWriteError(error),
  })

  function close() {
    setAsking(null)
    setReason('')
    setSold({})
  }

  function press(offered: OfferedAction) {
    /** Anything that needs a sentence or a product list opens the modal;
     *  walking a lead one step down the funnel does not, because a dialog
     *  asking nothing is a dialog in the way. */
    if (offered.requiresReason || offered.action === 'win' || offered.action === 'confirm') {
      setAsking(offered)
      return
    }
    run.mutate({ action: offered.action })
  }

  if (deal.actions.length === 0) {
    return <span className="text-[11.5px] text-muted">Không có hành động cho vai trò của bạn</span>
  }

  const missingProducts = needsProducts && Object.keys(sold).length === 0
  const missingAmount =
    needsProducts && Object.values(sold).some((value) => value.trim() === '')
  const missingReason = (asking?.requiresReason ?? false) && reason.trim().length === 0
  const blocked = missingProducts || missingAmount || missingReason || run.isPending

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {deal.actions.map((offered) => (
          <Button
            key={offered.action}
            size="sm"
            variant={PRIMARY.has(offered.action) ? 'primary' : undefined}
            disabled={run.isPending}
            onClick={() => press(offered)}
          >
            {t(`action.${offered.action}`)}
          </Button>
        ))}
      </div>

      <Modal
        open={asking !== null}
        onClose={close}
        width={520}
        title={asking ? t(`action.${asking.action}`) : ''}
        subtitle={`${deal.code} · ${t(`product.${deal.product}`)}`}
        footer={
          <>
            <Button size="lg" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              size="lg"
              variant={asking?.action === 'lose' ? 'danger' : 'primary'}
              disabled={blocked}
              onClick={() => asking && run.mutate({ action: asking.action })}
            >
              {run.isPending ? t('actions.working') : t('actions.send')}
            </Button>
          </>
        }
      >
        {asking ? (
          <p className="rounded-lg bg-sunken px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
            {t(`actions.sub.${asking.action}`)}
          </p>
        ) : null}

        {needsProducts ? (
          <SoldPicker value={sold} onChange={setSold} />
        ) : null}

        {asking?.requiresReason || asking?.action === 'confirm' ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted">
              {t('actions.reason')}
              {asking.requiresReason ? null : (
                <span className="ml-1.5 text-muted">· {t('common.optional')}</span>
              )}
            </span>
            <textarea
              id="reason"
              value={reason}
              rows={3}
              autoFocus={!needsProducts}
              onChange={(event) => setReason(event.target.value)}
              /** `tCode` rather than `t`: only the four moves that open this
               *  modal have a hint, and the type checker cannot see that the
               *  other two never get here. */
              placeholder={tCode('actions.hint', asking.action, '')}
              className={cx(inputBase, 'h-auto resize-y py-2.5 leading-relaxed')}
            />
            <span className="text-[11px] text-muted">{t('actions.reasonHint')}</span>
          </label>
        ) : null}
      </Modal>
    </>
  )
}

/** What the deal sold, one row per product.
 *
 *  Amounts are kept as strings while being typed: parsing on every keystroke
 *  means the box fights whoever is typing into it, and "0" has to survive
 *  being distinct from "not filled in yet". */
function SoldPicker({
  value,
  onChange,
}: {
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  function toggle(product: Product) {
    const next = { ...value }
    if (product in next) delete next[product]
    else next[product] = ''
    onChange(next)
  }

  const chosen = Object.keys(value)
  const total = Object.values(value).reduce(
    (sum, amount) => sum + (Number(amount.replace(/\D/g, '')) || 0),
    0,
  )

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] text-muted">{t('actions.sold')}</span>

      <div className="flex flex-wrap gap-1.5">
        {PRODUCTS.map((product) => (
          <button
            key={product}
            type="button"
            onClick={() => toggle(product)}
            className={cx(
              'rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
              product in value
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line2 text-muted hover:text-ink',
            )}
          >
            {t(`product.${product}`)}
          </button>
        ))}
      </div>

      {chosen.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {chosen.map((product) => (
            <label key={product} className="flex items-center gap-2">
              <span className="w-[150px] flex-none text-[12px]">
                {t(`product.${product as Product}`)}
              </span>
              <input
                value={value[product]}
                inputMode="numeric"
                placeholder="Số tiền, đồng"
                onChange={(event) =>
                  onChange({ ...value, [product]: event.target.value })
                }
                className={cx(inputBase, 'font-mono')}
              />
            </label>
          ))}
          {total > 0 ? (
            <span className="text-right font-mono text-[11px] text-muted">
              {fmtMoney(total)}
            </span>
          ) : null}
        </div>
      ) : null}

      <span className="text-[11px] leading-relaxed text-muted">{t('actions.soldHint')}</span>
    </div>
  )
}

/** The move that carries the lead forward gets the filled button. Two primary
 *  buttons side by side make neither one the obvious next step. */
const PRIMARY = new Set<ActionName>(['contact', 'advise', 'win'])

