import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

/** What Tia says when nobody has asked it anything.
 *
 *  Written here, not generated. That is the point rather than a shortcut: this
 *  bubble appears without anybody asking for it, so it must never claim
 *  anything about the branch. "Bạn có 3 việc quá hạn" would be a figure with
 *  no query behind it — the exact thing the assistant itself is forbidden from
 *  doing, said by the same character in the same voice.
 *
 *  So every line is one of two kinds: a question the person could ask, or
 *  something true about Tia. Nothing in between.
 *
 *  `ask` prefills the composer, so a line that proposes a question is one
 *  click from being that question. */
type Line = { text: string; ask?: string }

const LINES: Line[] = [
  { text: 'Ai chưa được gọi lần nào?', ask: 'Cơ hội nào chưa ai liên hệ lần nào?' },
  { text: 'Hỏi tôi cơ hội nào sắp đến hạn nhé.', ask: 'Cơ hội nào sắp đến hạn?' },
  { text: 'Vừa gọi khách xong? Kể tôi nghe, tôi ghi cho.' },
  { text: 'Tôi đọc số nhanh hơn bạn cuộn chuột.' },
  { text: 'Tháng này đang thế nào rồi?', ask: 'Tháng này tôi đang thế nào?' },
  { text: 'Tôi không tự ghi gì cả — lúc nào cũng hỏi bạn trước.' },
  { text: 'Deal nào đang vướng nhất?', ask: 'Những cơ hội thất bại gần đây vướng ở đâu?' },
  { text: 'Tôi chỉ thấy đúng phần dữ liệu bạn được xem thôi.' },
  { text: 'Có khách nào lâu rồi chưa hỏi han không nhỉ?', ask: 'Cơ hội nào im lặng quá 7 ngày?' },
]

/** How the bubble behaves over a working day.
 *
 *  The numbers are the whole design. A bubble that pops every thirty seconds
 *  is a colleague tapping your shoulder while you read; one that waits half a
 *  minute is a feature nobody ever sees — which is exactly what happened the
 *  first time this was tried at thirty seconds.
 *
 *  Eight is long enough that the page has settled and nothing jumps during the
 *  first glance, short enough that somebody looking for it finds it. Then a
 *  gap, three showings in all, and it stops for good and waits to be opened. */
export type BubbleTiming = {
  firstDelay: number
  visible: number
  gap: number
  maxShows: number
}

const DEFAULT_TIMING: BubbleTiming = {
  firstDelay: 8_000,
  visible: 11_000,
  gap: 45_000,
  maxShows: 3,
}

export function TiaBubble({
  suppressed,
  onAsk,
  timing = DEFAULT_TIMING,
}: {
  /** True while the assistant itself is open. Tia does not talk over Tia. */
  suppressed: boolean
  onAsk: (prefill?: string) => void
  /** Overridable so the behaviour can be exercised without waiting half a
   *  minute for the first bubble. A UI element that appears on its own is
   *  exactly the kind that silently stops appearing and nobody notices. */
  timing?: BubbleTiming
}) {
  const [line, setLine] = useState<Line | null>(null)
  const [leaving, setLeaving] = useState(false)
  const shows = useRef(0)
  const order = useRef<Line[]>([])

  /** Dismissing is for the session, not for ever. Somebody closing a bubble is
   *  saying "not now", and a preference stored across days is a different and
   *  larger promise than the gesture made. */
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (dismissed || suppressed) return

    let hideTimer: ReturnType<typeof setTimeout>
    let clearTimer: ReturnType<typeof setTimeout>

    const show = () => {
      if (shows.current >= timing.maxShows) return

      /** Shuffled once and drawn from, so the same line never lands twice in a
       *  row the way independent random picks do. */
      if (order.current.length === 0) order.current = shuffle(LINES)

      setLine(order.current.pop() ?? null)
      setLeaving(false)
      shows.current += 1

      hideTimer = setTimeout(() => setLeaving(true), timing.visible)
      clearTimer = setTimeout(() => setLine(null), timing.visible + 250)
    }

    const first = setTimeout(show, shows.current === 0 ? timing.firstDelay : timing.gap)
    const repeat = setInterval(show, timing.gap + timing.visible)

    return () => {
      clearTimeout(first)
      clearInterval(repeat)
      clearTimeout(hideTimer)
      clearTimeout(clearTimer)
    }
  }, [dismissed, suppressed, timing])

  if (!line || suppressed || dismissed) return null

  return (
    <div
      /** Left of the button and vertically centred on it, so the tail points
       *  sideways at the thing speaking. One line, however long — the header
       *  has the width to spare, and a bubble that wraps to three lines stops
       *  being an aside and becomes a panel. */
      className="tia-bubble absolute top-1/2 right-full z-50 mr-2.5 hidden -translate-y-1/2 lg:block"
      data-leaving={leaving}
      role="status"
    >
      <div
        className="relative flex items-center gap-2 rounded-[13px] border border-line2 py-[7px] pr-1.5 pl-3 whitespace-nowrap"
        style={{ background: 'var(--raised)', boxShadow: 'var(--shadow-lg)' }}
      >
        {/** The tail, a rotated square rather than a border triangle: a
          *  triangle made of borders has no edge of its own to colour, and
          *  this one has to carry the bubble's border across the join. */}
        <span
          className="absolute top-1/2 -right-[5px] size-[10px] -translate-y-1/2 rotate-45 rounded-[2px] border-t border-r"
          style={{ background: 'var(--raised)', borderColor: 'var(--line2)' }}
        />

        {/** A dot of Tia's gradient — enough to say who is speaking without a
          *  second avatar two centimetres from the first. */}
        <span
          className="size-[7px] flex-none rounded-full"
          style={{ background: 'var(--ai-grad)' }}
        />

        <button
          type="button"
          onClick={() => {
            setDismissed(true)
            onAsk(line.ask)
          }}
          className="cursor-pointer text-[12px] leading-none text-ink2 transition-colors hover:text-ink"
        >
          {line.text}
        </button>

        <span className="h-3.5 w-px flex-none bg-line" />

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setDismissed(true)
          }}
          aria-label="Ẩn lời nhắn"
          className="relative z-[1] grid size-5 flex-none cursor-pointer place-items-center rounded-[5px] text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  )
}

/** Fisher–Yates. A copy, because `LINES` is module state and shuffling it in
 *  place would reorder it for every other mount in the session. */
function shuffle(lines: Line[]): Line[] {
  const out = [...lines]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
