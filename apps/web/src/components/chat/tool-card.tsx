import { pct, type Funnel } from '~/api/reports'
import { t, tCode } from '~/i18n'
import { fmtNum } from '~/lib/format'
import { cx } from '~/components/ui/primitives'
import type { ChatToolCall } from '~/api/chat'

/** What a tool call looks like in the thread.
 *
 *  Two kinds, and the difference matters more than the styling. A **read** is
 *  a result: it already happened, and the card shows what came back. A
 *  **write** is a proposal: nothing has happened, the card shows the exact
 *  arguments, and two buttons decide.
 *
 *  Every figure here comes from `call.result` — the object the server got from
 *  its own query — and never from anything the model wrote. That is the whole
 *  reason the result is carried beside the message rather than inside it. */
export function ToolCard({
  call,
  onDecide,
  onPick,
  deciding,
  spoken,
}: {
  call: ChatToolCall
  onDecide: (callId: string, approve: boolean) => void
  /** Sends one of the assistant's own options as the next message. */
  onPick: (text: string) => void
  deciding: boolean
  /** True when the turn this call belongs to also has words in it. */
  spoken?: boolean
}) {
  if (call.name === 'ask_choice') {
    /** The model is told to put the question in the tool and say nothing
     *  around it. When it says something anyway, the question is dropped from
     *  the card rather than printed twice — the instruction is a request, this
     *  is the guarantee. */
    return <Choices call={call} onPick={onPick} busy={deciding} showQuestion={!spoken} />
  }

  if (call.status === 'pending' || WRITE_LABELS[call.name]) {
    return <ApprovalCard call={call} onDecide={onDecide} deciding={deciding} />
  }

  const body = readBody(call)
  if (!body) return null

  return (
    <div className="w-full overflow-hidden rounded-[12px] border border-line bg-raised">
      <div className="flex items-center gap-2 border-b border-line px-[13px] py-2.5">
        <span className="mr-auto text-[12.5px] font-semibold">{body.title}</span>
        {body.note ? (
          <span className="num text-[11px] text-muted">{body.note}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 px-[13px] py-3">
        {body.rows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} tone={row.tone} />
        ))}
      </div>
    </div>
  )
}

/* ──────────────────────────── A question back ───────────────────────────── */

/** The assistant asking which of several things was meant.
 *
 *  Buttons rather than a sentence listing the options, because the difference
 *  is the whole point: read as prose, "quá hạn, chưa ai liên hệ, hay sắp đến
 *  hạn?" makes the person type one of the three back. As buttons it is one
 *  click, and the text that gets sent is the full question the model wrote —
 *  not the short label on the button.
 *
 *  Drawn from the stored tool call, so what is on screen is exactly what the
 *  assistant asked for and nothing parsed out of its prose. */
function Choices({
  call,
  onPick,
  busy,
  showQuestion,
}: {
  call: ChatToolCall
  onPick: (text: string) => void
  busy: boolean
  showQuestion: boolean
}) {
  const asked = call.result as { question?: string; options?: Array<{ label: string; ask: string }> } | null
  const options = asked?.options ?? []
  if (options.length === 0) return null

  return (
    <div className="flex w-full flex-col gap-2">
      {showQuestion && asked?.question ? (
        <span className="text-[12.5px] leading-[1.5] text-pretty text-ink2">
          {asked.question}
        </span>
      ) : null}

      <div className="flex flex-wrap gap-[7px]">
        {options.map((option) => (
          <button
            key={option.ask}
            type="button"
            disabled={busy}
            onClick={() => onPick(option.ask)}
            title={option.ask}
            className="h-[27px] cursor-pointer rounded-full border border-line2 bg-surface px-[11px] text-[11.5px] font-medium text-ink2 transition-colors hover:border-[var(--accent)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── A proposed write ─────────────────────────── */

/** The four writes, named the way a person would describe the thing about to
 *  land in a customer's file — not by the tool's name. */
const WRITE_LABELS: Record<string, { head: string; cta: string }> = {
  record_signal: { head: 'Ghi tín hiệu vào hồ sơ khách', cta: 'Ghi lại' },
  draft_opportunity: { head: 'Tạo cơ hội mới', cta: 'Tạo cơ hội' },
  set_next_action: { head: 'Đặt hành động tiếp theo', cta: 'Đặt việc' },
  update_lead_fields: { head: 'Sửa thông tin cơ hội', cta: 'Lưu thay đổi' },
}

const FIELD_LABELS: Record<string, string> = {
  customerId: 'Khách hàng',
  opportunityId: 'Cơ hội',
  type: 'Loại tín hiệu',
  content: 'Nội dung',
  observedAt: 'Ngày quan sát',
  product: 'Sản phẩm',
  need: 'Nhu cầu',
  value: 'Giá trị',
  dueDate: 'Hạn xử lý',
  nextAction: 'Việc tiếp theo',
  blockerCode: 'Điểm vướng',
  blockerNote: 'Ghi chú điểm vướng',
}

function ApprovalCard({
  call,
  onDecide,
  deciding,
}: {
  call: ChatToolCall
  onDecide: (callId: string, approve: boolean) => void
  deciding: boolean
}) {
  const labels = WRITE_LABELS[call.name] ?? { head: call.name, cta: 'Đồng ý' }
  const state = STATES[call.status]

  return (
    <div
      className="w-full overflow-hidden rounded-[12px] border bg-raised"
      style={{ borderColor: state.border }}
    >
      <div
        className="flex items-center gap-2 border-b border-line px-[13px] py-[9px]"
        style={{ background: state.headBg }}
      >
        <span
          className="size-[7px] flex-none rounded-full"
          style={{ background: state.dot }}
        />
        <span className="mr-auto text-[11.5px] font-semibold" style={{ color: state.headFg }}>
          {state.head ?? labels.head}
        </span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 px-[13px] py-[11px]">
        {Object.entries(call.input)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => (
            <Row
              key={key}
              label={FIELD_LABELS[key] ?? key}
              value={fieldValue(key, value)}
              /** An id is not for reading, but hiding it would mean approving
               *  something whose target cannot be checked. Shown small. */
              mono={key.endsWith('Id')}
            />
          ))}
      </div>

      {call.status === 'pending' ? (
        <div className="flex items-center gap-2 border-t border-line px-[13px] py-2.5">
          <span className="mr-auto text-[11px] text-pretty text-muted">
            Chỉ ghi khi bạn bấm
          </span>
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(call.id, false)}
            className="h-[30px] cursor-pointer rounded-[8px] border border-line2 bg-transparent px-[11px] text-[12px] font-medium text-ink2 transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-50"
          >
            Bỏ
          </button>
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(call.id, true)}
            className="h-[30px] cursor-pointer rounded-[8px] border border-accent bg-accent px-[13px] text-[12px] font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {labels.cta}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Every state the card can be read in later, so scrolling back through a
 *  thread says what was actually decided rather than showing live buttons on
 *  something settled weeks ago. */
const STATES: Record<
  ChatToolCall['status'],
  { border: string; headBg: string; headFg: string; dot: string; head?: string }
> = {
  pending: {
    border: 'var(--warn)',
    headBg: 'var(--warn-soft)',
    headFg: 'var(--warn)',
    dot: 'var(--c-warn)',
  },
  approved: {
    border: 'var(--line)',
    headBg: 'var(--success-soft)',
    headFg: 'var(--success)',
    dot: 'var(--c-success)',
    head: 'Bạn đã duyệt — đã ghi vào hệ thống',
  },
  denied: {
    border: 'var(--line)',
    headBg: 'var(--sunken)',
    headFg: 'var(--muted)',
    dot: 'var(--c-neutral)',
    head: 'Bạn đã bỏ qua — không ghi gì',
  },
  failed: {
    border: 'var(--line)',
    headBg: 'var(--danger-soft)',
    headFg: 'var(--danger)',
    dot: 'var(--c-danger)',
    head: 'Hệ thống từ chối — không ghi được',
  },
  done: {
    border: 'var(--line)',
    headBg: 'var(--sunken)',
    headFg: 'var(--muted)',
    dot: 'var(--c-neutral)',
  },
}

function fieldValue(key: string, value: unknown): string {
  if (key === 'type') return tCode('signal', String(value), String(value))
  if (key === 'product') return t(`product.${value as 'card'}`)
  if (key === 'blockerCode') return tCode('blocker', String(value), String(value))
  if (key === 'value' && typeof value === 'number') return `${fmtNum(value)} đ`
  return String(value)
}

/* ────────────────────────────── A read result ───────────────────────────── */

type Body = {
  title: string
  note?: string
  rows: Array<{ label: string; value: string; tone?: string }>
}

/** Only the results worth a card get one.
 *
 *  A card per tool call would bury the answer: the assistant calls `whoami`
 *  and `today` on nearly every turn, and neither is news. What is left is the
 *  handful a person would want to see the figures behind. */
function readBody(call: ChatToolCall): Body | null {
  const result = call.result as Record<string, unknown> | null
  if (!result || call.status === 'failed') return null

  switch (call.name) {
    case 'get_funnel': {
      const f = result as unknown as Funnel
      if (!f.standing) return null
      return {
        title: 'Tình trạng lead',
        note: `${fmtNum(f.leads)} lead`,
        rows: [
          ...f.standing.map((part) => ({
            label: STANDING[part.state],
            value: `${fmtNum(part.value)} · ${pct(part.shareBps)}`,
          })),
          {
            label: 'Tỷ lệ chốt',
            value: `${pct(f.crBps, 1)} so ngưỡng ${pct(f.targetBps)}`,
            tone: f.crBps >= f.targetBps ? 'var(--success)' : 'var(--danger)',
          },
        ],
      }
    }

    case 'get_monthly': {
      const months = result as unknown as Array<{
        month: string
        won: number
        lost: number
        doneBps: number
      }>
      if (!Array.isArray(months) || months.length === 0) return null
      return {
        title: 'Kết quả theo tháng',
        note: `${months.length} tháng`,
        rows: months.slice(-6).map((row) => ({
          label: `Tháng ${Number(row.month.slice(5))}`,
          value: `chốt ${row.won} · trượt ${row.lost} · đạt ${pct(row.doneBps)}`,
        })),
      }
    }

    case 'get_breakdown': {
      const rows = result as unknown as Array<{ key: string; total: number; shareBps: number }>
      if (!Array.isArray(rows) || rows.length === 0) return null
      return {
        title: 'Cơ cấu cơ hội',
        rows: rows.slice(0, 7).map((row) => ({
          label: tCode('product', row.key, tCode('blocker', row.key, row.key)),
          value: `${fmtNum(row.total)} · ${pct(row.shareBps)}`,
        })),
      }
    }

    case 'get_by_owner':
    case 'get_by_team': {
      const rows = result as unknown as Array<{
        ownerName?: string
        leadName?: string
        leads: number
        won: number
        crBps: number
      }>
      if (!Array.isArray(rows) || rows.length === 0) return null
      return {
        title: call.name === 'get_by_owner' ? 'Theo nhân viên' : 'Theo nhóm',
        note: `${rows.length} dòng`,
        rows: rows.slice(0, 8).map((row) => ({
          label: row.ownerName ?? row.leadName ?? '',
          value: `${row.won}/${fmtNum(row.leads)} · ${pct(row.crBps, 1)}`,
        })),
      }
    }

    case 'search_opportunities':
    case 'search_customers': {
      const page = result as unknown as {
        total: number
        rows: Array<{ code?: string; name?: string; customerName?: string }>
      }
      if (!page.rows || page.rows.length === 0) return null
      return {
        title: call.name === 'search_customers' ? 'Khách hàng tìm được' : 'Cơ hội tìm được',
        note: `${fmtNum(page.total)} kết quả`,
        rows: page.rows.slice(0, 6).map((row) => ({
          label: row.name ?? row.customerName ?? '',
          value: row.code ?? '',
        })),
      }
    }

    default:
      return null
  }
}

const STANDING: Record<string, string> = {
  new: 'Chưa ai liên hệ',
  contacted: 'Đã liên hệ',
  advised: 'Đã tư vấn',
  won: 'Chốt thành công',
  lost: 'Thất bại',
}

function Row({
  label,
  value,
  tone,
  mono,
}: {
  label: string
  value: string
  tone?: string
  mono?: boolean
}) {
  return (
    <>
      <span className="text-[11.5px] text-muted">{label}</span>
      <span
        className={cx(
          'text-right text-[12.5px] font-medium text-pretty',
          mono ? 'font-mono text-[10.5px] break-all' : 'num',
        )}
        style={{ color: tone }}
      >
        {value}
      </span>
    </>
  )
}
