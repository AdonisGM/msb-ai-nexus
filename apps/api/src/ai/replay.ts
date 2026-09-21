import type Anthropic from '@anthropic-ai/sdk'
import type { AttachmentRef } from './attachments.service'

type Block = Anthropic.Beta.Messages.BetaContentBlockParam
type Turn = Anthropic.Beta.Messages.BetaMessageParam

/** The record a person had open when they asked, as a stored turn keeps it.
 *
 *  Like a file, a reference rather than the record: the model is told what is
 *  on screen and which tool reads it, and reads it itself if the question
 *  needs it. Handing it the whole file up front would pay for a customer's
 *  history on every turn of a thread that may be about something else — and
 *  would be a snapshot, stale the moment somebody edits the record. */
export type ContextRef = {
  type: 'context'
  kind: 'customer' | 'opportunity'
  id: string
  label: string
}

/** What the model reads in place of a context reference. */
export function contextNote(ref: ContextRef): string {
  /** The id is named as the argument to pass, word for word. Written as
   *  "(id …)" after a label that already held the display code, the model
   *  passed the code — `OPP-2026-0952` — and the lookup came back empty. */
  return ref.kind === 'customer'
    ? `[Ngữ cảnh: người dùng đang mở hồ sơ khách hàng ${ref.label}. "Khách này", "khách hàng này" là khách đó. Cần chi tiết thì gọi get_customer với customerId: "${ref.id}"; tín hiệu thì get_customer_signals với cùng customerId.]`
    : `[Ngữ cảnh: người dùng đang mở cơ hội ${ref.label}. "Cơ hội này", "deal này" là cơ hội đó. Cần chi tiết thì gọi get_opportunity với opportunityId: "${ref.id}"; vết xử lý thì get_opportunity_history với cùng opportunityId.]`
}

/** The day a question was asked, stored on the turn.
 *
 *  So the model has the date without calling `today` first — one fewer round
 *  trip, each of which re-sends the whole conversation. Stored rather than
 *  added at request time because a replayed turn must be byte-identical to
 *  what was sent before, or the cache misses from that turn on; and so an old
 *  turn still says which day "hôm nay" meant. */
export type ClockRef = { type: 'clock'; date: string }

/** The line the model reads for a stored date: the day, and the period
 *  starts the report tools ask for, which is most of what `today` returned. */
export function clockNote(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ]
  const pad = (n: number) => String(n).padStart(2, '0')
  const quarterStart = pad(Math.floor((m - 1) / 3) * 3 + 1)
  return (
    `[Hôm nay: ${weekday} ${pad(d)}/${pad(m)}/${y} (${date}). ` +
    `Tháng này từ ${y}-${pad(m)}-01, quý này từ ${y}-${quarterStart}-01, năm nay từ ${y}-01-01.]`
  )
}

/** Today's date in Vietnam, whatever timezone the server runs in. */
export function todayInVietnam(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now)
}

/** A stored turn, as much of it as replay needs. */
export type StoredTurn = { role: string; content: unknown }

/** How many exchanges keep their tool results in full when a thread is
 *  replayed — at least this many, at most twice as many less one.
 *
 *  A tool result can be twenty-five rows of a report, and every turn after it
 *  pays for those rows again. Older ones are replaced by a one-line stand-in —
 *  the block stays, because the API refuses an assistant turn whose `tool_use`
 *  has no matching `tool_result`, but its contents go. The assistant keeps the
 *  thread of the conversation and loses the raw data it has already used.
 *
 *  Cut in steps, not one exchange at a time. Hollowing a result rewrites the
 *  middle of the prompt, and everything after it misses the cache and is
 *  written again at 1.25×. A window that slid every turn did that every turn —
 *  including to a PDF sitting behind the hollowed results. Stepping by three
 *  exchanges means the prefix holds still for three turns, then moves once. */
export const REPLAY_TURNS = 3

/** How many of the person's own turns keep their files.
 *
 *  Counted in things the person said rather than in rows, unlike the tool
 *  results above. One question that sets off three tool calls is eight rows,
 *  and counting rows would drop a photo before anybody had asked a second
 *  thing about it. Two: the turn that carried the file and one follow-up —
 *  "and the second row?" — which is where nearly every question about a file
 *  is asked. After that it is a line saying the file was there. */
export const FILE_TURNS = 2

/** The ids of the files the model should see in full this time. Fetched
 *  before `replay`, which stays synchronous and so testable without storage. */
export function filesToLoad(rows: StoredTurn[]): string[] {
  const keep = fileWindow(rows)
  return rows.flatMap((row, index) =>
    keep.has(index) ? refsIn(row.content).map((ref) => ref.id) : [],
  )
}

/** The thread as the model should see it again.
 *
 *  Older tool results are hollowed out; files inside the window are swapped
 *  for their bytes and the rest for a line saying they were there. The newest
 *  file carries a cache breakpoint, so the tool loop's second and third
 *  requests — and the next question, if it comes within five minutes — read
 *  the file from cache rather than paying for it again. With the tools and the
 *  system prompt that is three breakpoints, inside the API's four. */
export function replay(rows: StoredTurn[], files: Map<string, Block>): Turn[] {
  const exchange = exchangeOf(rows)
  const total = exchange[exchange.length - 1] ?? 0
  const hollowBefore = Math.max(0, Math.floor((total - REPLAY_TURNS) / REPLAY_TURNS) * REPLAY_TURNS)
  const keep = fileWindow(rows)

  const turns = rows.map((row, index): Turn => {
    const role = row.role as 'user' | 'assistant'
    if (typeof row.content === 'string') return { role, content: row.content }

    const content = (row.content as (Block | AttachmentRef | ContextRef | ClockRef)[]).map((block): Block => {
      if (isContext(block)) return { type: 'text', text: contextNote(block) }
      if (isClock(block)) return { type: 'text', text: clockNote(block.date) }
      if (isRef(block)) {
        const loaded = keep.has(index) ? files.get(block.id) : undefined
        return (
          loaded ?? {
            type: 'text',
            text: `[Tệp "${block.name}" đã gửi ở lượt trước, không còn trong ngữ cảnh. Nếu cần xem lại, hãy nhờ người dùng gửi lại.]`,
          }
        )
      }
      /** A citation points into the documents of the request that produced
       *  it, by position. Replayed, that document may be a placeholder line
       *  or sit at a different index, so the pointer goes and the words stay.
       *  The screen keeps them — it reads the stored turn, not this. */
      if (block.type === 'text' && 'citations' in block && block.citations) {
        return { type: 'text', text: block.text }
      }
      if (block.type === 'tool_result' && hollowBefore > 0 && exchange[index] <= hollowBefore) {
        return { ...block, content: '[kết quả cũ, đã lược bớt để tiết kiệm ngữ cảnh]' }
      }
      return block
    })

    return { role, content }
  })

  markNewestFile(turns)
  return turns
}

/** For each row, how many turns the person has typed up to and including
 *  it — the exchange it belongs to, counted from 1. */
function exchangeOf(rows: StoredTurn[]): number[] {
  let count = 0
  return rows.map((row) => {
    if (isTyped(row)) count += 1
    return count
  })
}

function isTyped(row: StoredTurn): boolean {
  if (row.role !== 'user') return false
  if (typeof row.content === 'string') return true
  return !(row.content as Block[]).every((block) => block.type === 'tool_result')
}

/** Row indices of the last `FILE_TURNS` turns the person typed. A user row
 *  that only carries tool results back is the runner's, not theirs. */
function fileWindow(rows: StoredTurn[]): Set<number> {
  const typed: number[] = []
  rows.forEach((row, index) => {
    if (isTyped(row)) typed.push(index)
  })
  return new Set(typed.slice(-FILE_TURNS))
}

function markNewestFile(turns: Turn[]) {
  for (let t = turns.length - 1; t >= 0; t--) {
    const content = turns[t].content
    if (typeof content === 'string') continue

    for (let b = content.length - 1; b >= 0; b--) {
      const block = content[b]
      if (block.type === 'image' || block.type === 'document') {
        content[b] = { ...block, cache_control: { type: 'ephemeral' } }
        return
      }
    }
  }
}

function isClock(block: unknown): block is ClockRef {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'clock'
  )
}

function isContext(block: unknown): block is ContextRef {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'context'
  )
}

export function refsIn(content: unknown): AttachmentRef[] {
  return Array.isArray(content) ? content.filter(isRef) : []
}

function isRef(block: unknown): block is AttachmentRef {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'attachment'
  )
}
