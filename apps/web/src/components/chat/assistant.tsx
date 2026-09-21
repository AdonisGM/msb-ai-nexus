import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Paperclip, Trash2, X } from 'lucide-react'
import {
  ATTACH_ACCEPT,
  ATTACH_MAX_PER_MESSAGE,
  attachLimitFor,
  attachmentUrl,
  chatStatusQuery,
  conversationsQuery,
  deleteConversation,
  filesOf,
  startConversation,
  streamTurn,
  textOf,
  threadQuery,
  uploadAttachment,
  type Attachment,
  type ChatMessage,
  type ChatToolCall,
  type Conversation,
} from '~/api/chat'
import { ApiError } from '~/api/client'
import { cx } from '~/components/ui/primitives'
import { tError } from '~/i18n'
import { useWriteError } from '~/lib/use-write-error'
import { Markdown } from './markdown'
import { Spark } from './spark'
import { ToolCard } from './tool-card'

/** The assistant, as a floating panel.
 *
 *  A popup rather than a docked rail: the design offers both, and a rail
 *  permanently narrows every screen behind it for a thing most people open a
 *  few times a day. The frame is the design's — a 1.5px gradient edge drawn as
 *  padding on the outer box, because a gradient cannot be a `border-color`.
 *
 *  What the design shows and this does not: the dock/float switch (there is
 *  one mode now), the reply chips (the server returns no suggestions), and
 *  "Mở form" on an approval card (the approval is the form — it already shows
 *  every argument, and a second path to the same write is a second place for
 *  them to disagree). */

/** A file in the composer, from the moment it is picked until it is sent.
 *
 *  Uploaded straight away rather than with the message, so a photo is on its
 *  way while the person is still typing about it. `preview` is a local object
 *  URL for images — the server's copy is not needed to show what was just
 *  picked from this very machine. */
type Pending = {
  key: string
  name: string
  kind: Attachment['kind']
  preview?: string
  state: 'uploading' | 'ready' | 'failed'
  ref?: Attachment
  error?: string
}

const QUICK = [
  'Hôm nay tôi nên làm gì trước?',
  'Cơ hội nào đang quá hạn?',
  'Tháng này tôi đang thế nào?',
]

export function Assistant({
  open,
  onClose,
  subject,
  prefill,
}: {
  open: boolean
  onClose: () => void
  /** A question the person arrived with — from a bubble they clicked. Put in
   *  the box rather than sent, so they can change it first. */
  prefill?: string
  /** What the screen behind is about, so a thread opened from a customer file
   *  comes back to that file rather than starting blank. */
  subject?: { kind: 'customer' | 'opportunity'; id: string; label: string }
}) {
  const queryClient = useQueryClient()
  const onWriteError = useWriteError()

  const [threadId, setThreadId] = useState<string | null>(null)
  const [showSessions, setShowSessions] = useState(false)
  const [draft, setDraft] = useState('')

  /** Only when it changes, so reopening the popup does not overwrite whatever
   *  was half-typed in it. */
  useEffect(() => {
    if (prefill) setDraft(prefill)
  }, [prefill])
  const [keepContext, setKeepContext] = useState(true)

  const status = useQuery(chatStatusQuery())
  const canAttach = status.data?.attachments === true
  const [pending, setPending] = useState<Pending[]>([])

  const list = useQuery({ ...conversationsQuery(), enabled: open })
  const thread = useQuery({ ...threadQuery(threadId), enabled: open && threadId !== null })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['chat'] })
  }

  const start = useMutation({
    mutationFn: () =>
      startConversation(
        keepContext && subject ? { subjectKind: subject.kind, subjectId: subject.id } : {},
      ),
    onSuccess: (conversation) => {
      setThreadId(conversation.id)
      setShowSessions(false)
      refresh()
    },
    onError: (error: unknown) => void onWriteError(error),
  })

  /** What is arriving right now: the words so far and the tools reached for.
   *
   *  Kept apart from the stored thread rather than spliced into it. A turn in
   *  flight has no id, no tool results and nothing anybody can approve — it is
   *  a preview, and merging it with records that are real is how a half-written
   *  sentence ends up looking like something that happened. */
  const [live, setLive] = useState<{ text: string; tools: string[] } | null>(null)
  const [failed, setFailed] = useState('')

  /** What the person just said, shown back to them before the server has
   *  stored it.
   *
   *  Without this the composer empties and nothing appears for as long as the
   *  loop runs — the assistant starts typing and their own question is still
   *  nowhere. Cleared at the same moment the preview is, so the stored turn
   *  takes its place rather than appearing beside it. */
  const [echo, setEcho] = useState<{ text: string; files: Pending[] } | null>(null)

  /** Resolves to whether the turn went through, so a failed send can hand its
   *  files back to the composer — they are still unsent on the server. */
  const run = async (path: string, body: unknown, said?: { text: string; files: Pending[] }) => {
    setFailed('')
    setEcho(said ?? null)
    setLive({ text: '', tools: [] })
    let ok = true

    try {
      await streamTurn(path, body, (event) => {
        if (event.kind === 'text') {
          setLive((was) => ({ ...(was ?? { tools: [] }), text: (was?.text ?? '') + event.delta }))
        } else if (event.kind === 'tool') {
          setLive((was) => ({
            text: was?.text ?? '',
            /** Named once however many times it is called: three searches in a
             *  row is one thing happening, not three. */
            tools: was?.tools.includes(event.name) ? was.tools : [...(was?.tools ?? []), event.name],
          }))
        } else if (event.kind === 'error') {
          ok = false
          setFailed(event.message)
        }
      })
    } catch (error) {
      ok = false
      setFailed(error instanceof Error ? error.message : 'unexpected_error')
    } finally {
      /** The stored turn replaces the preview — it has the ids, the tool
       *  results and anything waiting for approval. Cleared only after the
       *  refetch lands, or the thread blinks empty in between. */
      await queryClient.invalidateQueries({ queryKey: ['chat'] })
      setLive(null)
      setEcho(null)
      /** An approved write changed the branch's data, so every screen behind
       *  the popup is now stale too. */
      void queryClient.invalidateQueries()
    }
    return ok
  }

  const sending = live !== null

  /** Files belong to a thread, so switching threads drops what was waiting. */
  const clearPending = () => {
    setPending((was) => {
      for (const file of was) if (file.preview) URL.revokeObjectURL(file.preview)
      return []
    })
  }

  const ensureThread = async () =>
    threadId ??
    (
      await startConversation(
        keepContext && subject ? { subjectKind: subject.kind, subjectId: subject.id } : {},
      )
    ).id

  const attach = (picked: File[]) => {
    const room = ATTACH_MAX_PER_MESSAGE - pending.filter((file) => file.state !== 'failed').length
    if (picked.length === 0) return
    if (room <= 0) return setFailed('attachment_too_many')
    setFailed('')

    void (async () => {
      const id = await ensureThread()
      setThreadId(id)

      await Promise.all(
        picked.slice(0, room).map(async (file) => {
          const key = `${file.name}-${file.size}-${Math.random()}`
          const kind: Attachment['kind'] = file.type.startsWith('image/')
            ? 'image'
            : file.type === 'application/pdf'
              ? 'pdf'
              : 'text'
          const tooBig = file.size > attachLimitFor(file)

          setPending((was) => [
            ...was,
            {
              key,
              name: file.name,
              kind,
              preview: kind === 'image' && !tooBig ? URL.createObjectURL(file) : undefined,
              state: tooBig ? 'failed' : 'uploading',
              error: tooBig ? 'attachment_too_large' : undefined,
            },
          ])
          if (tooBig) return

          try {
            const ref = await uploadAttachment(id, file)
            setPending((was) =>
              was.map((one) =>
                one.key === key ? { ...one, state: 'ready', ref, kind: ref.kind } : one,
              ),
            )
          } catch (error) {
            const code = error instanceof ApiError ? error.message : 'unexpected_error'
            setPending((was) =>
              was.map((one) => (one.key === key ? { ...one, state: 'failed', error: code } : one)),
            )
          }
        }),
      )
    })().catch((error: unknown) => void onWriteError(error))
  }

  const dropPending = (key: string) => {
    setPending((was) => {
      const gone = was.find((file) => file.key === key)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return was.filter((file) => file.key !== key)
    })
  }

  const remove = useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_, id) => {
      if (id === threadId) setThreadId(null)
      refresh()
    },
    onError: (error: unknown) => void onWriteError(error),
  })

  /** Esc closes, wherever the focus is. */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  /** Every turn, not just the ones with words in them.
   *
   *  A tool call lives on the assistant turn that asked for it, and that turn
   *  is very often text-only-later: the model calls `search_customers`, says
   *  nothing, reads the result in the next turn and answers there. Filtering
   *  on text dropped exactly those turns — and with them every card they
   *  carried, results and approvals alike. `Thread` skips what renders to
   *  nothing instead, which is a different question from what has prose. */
  const messages = thread.data?.messages ?? []

  /** The echo stops the moment the real turn is on screen.
   *
   *  Clearing it after the refetch is not enough: the query cache updates and
   *  renders before the state setter that follows the `await` runs, so for one
   *  frame the same sentence would appear twice. Comparing against what is
   *  stored is independent of that ordering. */
  const last = messages[messages.length - 1]
  const showEcho =
    echo !== null &&
    !(
      last?.role === 'user' &&
      textOf(last) === echo.text &&
      filesOf(last).length === echo.files.length
    )
  const calls = thread.data?.toolCalls ?? []
  const busy = sending
  const uploading = pending.some((file) => file.state === 'uploading')
  const ready = pending.filter((file) => file.state === 'ready')

  const submit = () => {
    const text = draft.trim()
    if ((!text && ready.length === 0) || busy || uploading) return
    setDraft('')

    const sent = ready
    setPending((was) => was.filter((file) => file.state === 'failed'))

    void (async () => {
      /** A first message with no thread yet opens one, so nobody has to press
       *  "new" before they can type. */
      const id = await ensureThread()
      setThreadId(id)

      const ok = await run(
        `/chat/${id}/messages/stream`,
        { text, attachmentIds: sent.map((file) => file.ref!.id) },
        { text, files: sent },
      )

      if (ok) {
        for (const file of sent) if (file.preview) URL.revokeObjectURL(file.preview)
      } else {
        /** The turn failed before the files were pinned to it, so they are
         *  still sendable — back into the composer rather than lost. */
        setPending((was) => [...sent, ...was])
      }
    })()
  }

  return (
    <div
      role="dialog"
      aria-label="Trợ lý Tia"
      className="fixed z-40 flex overflow-hidden rounded-[16px] p-[1.5px]
                 right-4 bottom-4 left-4 top-16
                 sm:left-auto sm:w-[min(560px,calc(100vw-48px))] sm:h-[min(660px,calc(100vh-96px))]"
      style={{ background: 'var(--ai-grad)', boxShadow: 'var(--ai-glow), var(--shadow-lg)' }}
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14.5px] bg-surface">
        <Header
          title={thread.data?.conversation.title || 'Tia'}
          onSessions={() => setShowSessions((was) => !was)}
          sessionsOpen={showSessions}
          onClose={onClose}
        />

        {showSessions ? (
          <Sessions
            rows={list.data ?? []}
            current={threadId}
            onPick={(id) => {
              if (id !== threadId) clearPending()
              setThreadId(id)
              setShowSessions(false)
            }}
            onNew={() => {
              clearPending()
              start.mutate()
            }}
            onRemove={(id) => remove.mutate(id)}
          />
        ) : (
          <>
            <ContextBar
              subject={subject}
              keeping={keepContext}
              onDrop={() => setKeepContext(false)}
              onRestore={() => setKeepContext(true)}
            />

            <Thread
              threadId={threadId}
              messages={messages}
              calls={calls}
              echo={showEcho ? echo : null}
              live={live}
              failed={failed}
              onDecide={(callId, approve) =>
                void run(
                  `/chat/${threadId}/tool-calls/${callId}/${approve ? 'approve' : 'deny'}/stream`,
                  {},
                )
              }
              onPick={(text) =>
                void run(`/chat/${threadId}/messages/stream`, { text }, { text, files: [] })
              }
              deciding={sending}
            />

            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={submit}
              busy={busy}
              showQuick={messages.length === 0}
              canAttach={canAttach}
              pending={pending}
              onAttach={attach}
              onDrop={dropPending}
              canSend={(draft.trim() !== '' || ready.length > 0) && !uploading}
            />
          </>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────── The parts ──────────────────────────────── */

function Header({
  title,
  onSessions,
  sessionsOpen,
  onClose,
}: {
  title: string
  onSessions: () => void
  sessionsOpen: boolean
  onClose: () => void
}) {
  return (
    <div
      className="flex flex-none items-center gap-2.5 border-b border-line py-[11px] pr-3 pl-3.5"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in oklch, oklch(.63 .21 34) 8%, var(--surface)), var(--surface))',
      }}
    >
      <Spark size={26} />
      <span className="mr-auto flex min-w-0 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold tracking-[-.01em]">{title}</span>
        <span className="truncate text-[10.5px] text-muted">Trợ lý bán hàng</span>
      </span>

      <button
        type="button"
        onClick={onSessions}
        className={cx(
          'h-[26px] flex-none cursor-pointer rounded-[8px] border border-line2 px-[9px] text-[11.5px] font-medium transition-colors hover:border-[var(--accent)]',
          sessionsOpen ? 'bg-sunken text-ink' : 'bg-transparent text-ink2',
        )}
      >
        Phiên
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng trợ lý"
        className="grid size-[26px] flex-none cursor-pointer place-items-center rounded-[8px] border border-line2 text-ink2 transition-colors hover:bg-sunken"
      >
        <X size={13} />
      </button>
    </div>
  )
}

function Sessions({
  rows,
  current,
  onPick,
  onNew,
  onRemove,
}: {
  rows: Conversation[]
  current: string | null
  onPick: (id: string) => void
  onNew: () => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
      <div className="flex items-center gap-2.5">
        <span className="mr-auto text-[11.5px] text-muted">Các phiên gần đây</span>
        <button
          type="button"
          onClick={onNew}
          className="h-[26px] cursor-pointer rounded-[8px] border border-accent bg-accent px-2.5 text-[11.5px] font-medium text-accent-fg"
        >
          Phiên mới
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-muted">Chưa có phiên nào.</p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className={cx(
              'group flex items-center gap-2 rounded-[11px] border px-3 py-2.5 transition-colors',
              row.id === current ? 'border-line2 bg-sunken' : 'border-line bg-raised',
            )}
          >
            <button
              type="button"
              onClick={() => onPick(row.id)}
              className="flex min-w-0 flex-1 cursor-pointer flex-col gap-[3px] text-left"
            >
              <span
                className={cx(
                  'truncate text-[12.5px] text-ink',
                  row.id === current ? 'font-semibold' : 'font-normal',
                )}
              >
                {row.title || 'Phiên chưa đặt tên'}
              </span>
              <span className="num text-[10.5px] text-muted">{when(row.lastMessageAt)}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              aria-label="Xoá phiên"
              className="grid size-6 flex-none cursor-pointer place-items-center rounded-[6px] text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      )}
    </div>
  )
}

function ContextBar({
  subject,
  keeping,
  onDrop,
  onRestore,
}: {
  subject?: { label: string }
  keeping: boolean
  onDrop: () => void
  onRestore: () => void
}) {
  if (!subject) return null

  return (
    <div className="flex flex-none flex-wrap items-center gap-[7px] border-b border-line bg-raised px-3 py-2">
      <span className="flex-none text-[10.5px] text-muted">Ngữ cảnh</span>
      {keeping ? (
        <span className="flex h-6 items-center gap-1.5 rounded-[7px] border border-line2 bg-surface pr-1 pl-[9px] text-[11.5px] whitespace-nowrap text-ink2">
          <span className="max-w-[220px] truncate">{subject.label}</span>
          <button
            type="button"
            onClick={onDrop}
            aria-label="Bỏ ngữ cảnh"
            className="grid size-4 cursor-pointer place-items-center rounded-[5px] text-muted hover:bg-sunken"
          >
            <X size={10} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={onRestore}
          className="cursor-pointer text-[11.5px] text-ink2 underline decoration-[var(--line2)]"
        >
          Dùng lại trang hiện tại
        </button>
      )}
    </div>
  )
}

function Thread({
  threadId,
  messages,
  calls,
  echo,
  live,
  failed,
  onDecide,
  onPick,
  deciding,
}: {
  threadId: string | null
  messages: ChatMessage[]
  calls: ChatToolCall[]
  echo: { text: string; files: Pending[] } | null
  live: { text: string; tools: string[] } | null
  failed: string
  onDecide: (callId: string, approve: boolean) => void
  onPick: (text: string) => void
  deciding: boolean
}) {
  const bottom = useRef<HTMLDivElement>(null)

  /** A turn is worth a row if it says something or shows something. The rest
   *  is transcript: the `user` turns the runner writes to carry tool results
   *  back to the model have neither, and belong to the record rather than to
   *  the reader. */
  const shown = messages
    .map((message) => ({
      message,
      text: textOf(message),
      files: filesOf(message),
      calls: calls.filter((call) => call.messageId === message.id),
    }))
    .filter((row) => row.text !== '' || row.files.length > 0 || row.calls.length > 0)

  /** Follows the text down as it is written, not just when a turn ends. */
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [shown.length, calls.length, echo, live?.text, live?.tools.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 py-3.5">
      {shown.length === 0 && !live && !echo ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Spark size={34} />
          <span className="mt-1 text-[13px] font-medium">Hỏi Tia</span>
          <p className="max-w-[300px] text-[11.5px] leading-relaxed text-muted">
            Về khách hàng, cơ hội hay số liệu của bạn. Tia cũng ghi lại được việc bạn
            vừa làm — nhưng luôn hỏi trước khi ghi.
          </p>
        </div>
      ) : null}

      {shown.map((row) => (
        <Turn
          key={row.message.id}
          threadId={threadId}
          message={row.message}
          text={row.text}
          files={row.files}
          calls={row.calls}
          onDecide={onDecide}
          onPick={onPick}
          deciding={deciding}
        />
      ))}

      {echo ? (
        <div className="flex flex-col items-end gap-[7px]">
          {echo.files.length > 0 ? (
            <div className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
              {echo.files.map((file) => (
                <LocalFile key={file.key} file={file} />
              ))}
            </div>
          ) : null}
          {echo.text ? (
            <div className="max-w-[88%] rounded-[12px_12px_4px_12px] border border-accent bg-accent px-3 py-[9px] text-[13px] leading-[1.55] text-accent-fg">
              <Markdown text={echo.text} inverted />
            </div>
          ) : null}
        </div>
      ) : null}

      {live ? <Live live={live} /> : null}

      {failed ? (
        <div
          className="rounded-[10px] border px-3 py-2 text-[12px]"
          style={{
            borderColor: 'var(--danger)',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
          }}
        >
          {tError(failed)}
        </div>
      ) : null}

      <div ref={bottom} />
    </div>
  )
}

/** The turn in flight.
 *
 *  Three states in one place, because they are one state as far as the person
 *  waiting is concerned: nothing yet, reading something, writing the answer.
 *  What makes the wait bearable is not a spinner but knowing which of the
 *  three it is in. */
function Live({ live }: { live: { text: string; tools: string[] } }) {
  return (
    <div className="flex flex-col items-start gap-[7px]">
      {live.tools.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Đang đọc</span>
          {live.tools.map((name) => (
            <span
              key={name}
              className="flex h-[21px] items-center rounded-full border border-line bg-sunken px-2 text-[10.5px] text-ink2"
            >
              {TOOL_WORDS[name] ?? name}
            </span>
          ))}
        </div>
      ) : null}

      {live.text ? (
        <div className="max-w-[88%] rounded-[12px_12px_12px_4px] border border-line bg-raised px-3 py-[9px] text-[13px] leading-[1.55] text-ink">
          <Markdown text={live.text} />
          {/** A caret at the end of what has arrived, so a pause between
            *  tokens reads as writing rather than as finished. */}
          <span className="tia-caret ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-ink" />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-[12px_12px_12px_4px] border border-line bg-raised px-3 py-2.5">
          <span className="tia-dot" />
          <span className="tia-dot" style={{ animationDelay: '.16s' }} />
          <span className="tia-dot" style={{ animationDelay: '.32s' }} />
        </div>
      )}
    </div>
  )
}

/** Tool names said the way the work is said. "get_by_owner" is accurate and
 *  means nothing to the person reading it. */
const TOOL_WORDS: Record<string, string> = {
  whoami: 'hồ sơ của bạn',
  today: 'lịch',
  list_codes: 'danh mục mã',
  get_org_tree: 'sơ đồ tổ chức',
  get_targets: 'chỉ tiêu',
  search_customers: 'danh sách khách',
  get_customer: 'hồ sơ khách',
  get_customer_signals: 'tín hiệu khách',
  list_customer_facets: 'bộ lọc khách',
  search_opportunities: 'danh sách cơ hội',
  get_opportunity: 'chi tiết cơ hội',
  get_opportunity_history: 'vết xử lý',
  get_funnel: 'phễu',
  get_monthly: 'số liệu theo tháng',
  get_breakdown: 'cơ cấu',
  get_by_owner: 'theo nhân viên',
  get_by_team: 'theo nhóm',
  tool_search_tool_bm25: 'tìm công cụ',
  record_signal: 'soạn tín hiệu',
  draft_opportunity: 'soạn cơ hội',
  set_next_action: 'soạn việc tiếp theo',
  update_lead_fields: 'soạn chỉnh sửa',
}

function Turn({
  threadId,
  message,
  text,
  files,
  calls,
  onDecide,
  onPick,
  deciding,
}: {
  threadId: string | null
  message: ChatMessage
  text: string
  files: Attachment[]
  calls: ChatToolCall[]
  onDecide: (callId: string, approve: boolean) => void
  onPick: (text: string) => void
  deciding: boolean
}) {
  const mine = message.role === 'user'

  return (
    <div className={cx('flex flex-col gap-[7px]', mine ? 'items-end' : 'items-start')}>
      {files.length > 0 && threadId ? (
        <div className={cx('flex max-w-[88%] flex-wrap gap-1.5', mine && 'justify-end')}>
          {files.map((file) => (
            <StoredFile key={file.id} threadId={threadId} file={file} />
          ))}
        </div>
      ) : null}

      {text ? (
        <div
          className={cx(
            'max-w-[88%] border px-3 py-[9px] text-[13px] leading-[1.55] text-pretty',
            mine
              ? 'rounded-[12px_12px_4px_12px] border-accent bg-accent text-accent-fg'
              : 'rounded-[12px_12px_12px_4px] border-line bg-raised text-ink',
          )}
        >
          <Markdown text={text} inverted={mine} />
        </div>
      ) : null}

      {calls.map((call) => (
        <ToolCard
          key={call.id}
          call={call}
          onDecide={onDecide}
          onPick={onPick}
          deciding={deciding}
          spoken={text !== ''}
        />
      ))}
    </div>
  )
}

function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  showQuick,
  canAttach,
  pending,
  onAttach,
  onDrop,
  canSend,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  busy: boolean
  showQuick: boolean
  canAttach: boolean
  pending: Pending[]
  onAttach: (files: File[]) => void
  onDrop: (key: string) => void
  canSend: boolean
}) {
  const picker = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-none flex-col gap-2 border-t border-line bg-surface px-3 pt-[9px] pb-[11px]">
      {showQuick ? (
        <div className="flex flex-wrap gap-[7px]">
          {QUICK.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={busy}
              onClick={() => {
                onChange(prompt)
                queueMicrotask(onSubmit)
              }}
              className="h-[26px] cursor-pointer rounded-full border border-transparent bg-sunken px-2.5 text-[11.5px] text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {pending.map((file) => (
            <PendingChip key={file.key} file={file} onDrop={() => onDrop(file.key)} />
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 rounded-[11px] border border-line2 bg-sunken py-1.5 pr-1.5 pl-[11px]">
        {canAttach ? (
          <>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={busy}
              aria-label="Đính kèm ảnh, PDF hoặc tệp văn bản"
              title="Đính kèm ảnh, PDF hoặc tệp văn bản"
              className="-ml-1 grid size-[30px] flex-none cursor-pointer place-items-center rounded-[8px] text-muted transition-colors hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Paperclip size={15} />
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              className="hidden"
              onChange={(event) => {
                onAttach([...(event.target.files ?? [])])
                /** Cleared so picking the same file again still fires. */
                event.target.value = ''
              }}
            />
          </>
        ) : null}
        <input
          type="text"
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            /** A screenshot pasted into the box is the quickest way to show
             *  the assistant something on the screen. */
            if (!canAttach) return
            const files = [...event.clipboardData.files]
            if (files.length === 0) return
            event.preventDefault()
            onAttach(files)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder="Hỏi hoặc ghi nhận việc vừa làm"
          className="h-[30px] min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !canSend}
          className="h-[30px] flex-none cursor-pointer rounded-[8px] border border-accent bg-accent px-[13px] text-[12px] font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Gửi
        </button>
      </div>

      <span className="text-[10.5px] leading-relaxed text-pretty text-muted">
        Tia đọc dữ liệu bạn được xem. Mọi thay đổi đều cần bạn xác nhận.
      </span>
    </div>
  )
}

function when(iso: string): string {
  const at = new Date(iso)
  const now = new Date()
  const sameDay = at.toDateString() === now.toDateString()
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

  if (sameDay) return `Hôm nay, ${time}`
  return `${String(at.getDate()).padStart(2, '0')}/${String(at.getMonth() + 1).padStart(2, '0')}, ${time}`
}

/* ─────────────────────────────── Files ──────────────────────────────────── */

function PendingChip({ file, onDrop }: { file: Pending; onDrop: () => void }) {
  return (
    <span
      title={file.error ? tError(file.error) : file.name}
      className={cx(
        'flex h-[30px] max-w-[220px] items-center gap-1.5 rounded-[8px] border bg-raised pr-1 pl-1 text-[11.5px]',
        file.state === 'failed' ? 'border-[var(--danger)] text-[var(--danger)]' : 'border-line2 text-ink2',
      )}
    >
      {file.preview ? (
        <img src={file.preview} alt="" className="size-[22px] flex-none rounded-[5px] object-cover" />
      ) : (
        <FileText size={14} className="ml-1 flex-none" />
      )}
      <span className="truncate">{file.name}</span>
      {file.state === 'uploading' ? <span className="tia-dot flex-none" /> : null}
      <button
        type="button"
        onClick={onDrop}
        aria-label={`Bỏ ${file.name}`}
        className="grid size-5 flex-none cursor-pointer place-items-center rounded-[5px] text-muted hover:bg-sunken"
      >
        <X size={11} />
      </button>
    </span>
  )
}

/** A file just sent, drawn from the local copy until the stored turn lands. */
function LocalFile({ file }: { file: Pending }) {
  if (file.preview) {
    return (
      <img
        src={file.preview}
        alt={file.name}
        className="max-h-[160px] max-w-[220px] rounded-[10px] border border-line object-cover"
      />
    )
  }
  return <FileBadge name={file.name} kind={file.kind} />
}

/** A file on a stored turn. Images load as thumbnails; anything else is a
 *  chip that opens the file in a new tab. */
function StoredFile({ threadId, file }: { threadId: string; file: Attachment }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (file.kind !== 'image') return
    let url: string | null = null
    let cancelled = false
    attachmentUrl(threadId, file.id)
      .then((made) => {
        url = made
        if (cancelled) URL.revokeObjectURL(made)
        else setSrc(made)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [threadId, file.id, file.kind])

  /** The tab is opened before the fetch, in the click itself — a window
   *  opened after an await is a popup, and browsers block those. */
  const openIt = () => {
    const tab = window.open('', '_blank')
    if (!tab) return
    if (src) {
      tab.location.href = src
      return
    }
    attachmentUrl(threadId, file.id)
      .then((url) => {
        tab.location.href = url
      })
      .catch(() => tab.close())
  }

  if (file.kind === 'image') {
    return (
      <button type="button" onClick={openIt} className="cursor-zoom-in" title={file.name}>
        {src ? (
          <img
            src={src}
            alt={file.name}
            className="max-h-[160px] max-w-[220px] rounded-[10px] border border-line object-cover"
          />
        ) : (
          <span className="block h-[90px] w-[120px] rounded-[10px] border border-line bg-sunken" />
        )}
      </button>
    )
  }

  return (
    <button type="button" onClick={openIt} className="cursor-pointer" title={file.name}>
      <FileBadge name={file.name} kind={file.kind} size={file.size} />
    </button>
  )
}

function FileBadge({ name, kind, size }: { name: string; kind: Attachment['kind']; size?: number }) {
  return (
    <span className="flex h-[38px] max-w-[240px] items-center gap-2 rounded-[10px] border border-line2 bg-raised px-2.5 text-left">
      <FileText size={16} className="flex-none text-muted" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] text-ink">{name}</span>
        <span className="text-[10.5px] text-muted">
          {kind === 'pdf' ? 'PDF' : kind === 'text' ? 'Văn bản' : 'Ảnh'}
          {size !== undefined ? ` · ${bytes(size)}` : ''}
        </span>
      </span>
    </span>
  )
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
