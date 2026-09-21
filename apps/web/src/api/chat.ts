import { queryOptions } from '@tanstack/react-query'
import { api, API_BASE, ApiError } from './client'

/** The assistant, as the screen sees it.
 *
 *  Messages carry Anthropic's own content blocks, which is what the server
 *  stores — the shape is not ours to choose, so it is named rather than
 *  reshaped. Tool calls come back beside them rather than inside: a chart in
 *  the thread is drawn from `result`, and digging that out of a content block
 *  on every render would put the SDK's shape into the web app. */

export type Renderer =
  | 'funnel.ring'
  | 'trend.monthly'
  | 'breakdown.bars'
  | 'table.opportunities'
  | 'table.customers'
  | 'table.owners'
  | 'table.teams'
  | 'card.customer'
  | 'card.opportunity'
  | 'card.signal'
  | 'choices'
  | 'timeline.signals'
  | 'timeline.history'
  | null

/** A file on a turn. Not an Anthropic block — the server keeps files by
 *  reference and swaps the bytes in only when it asks the model. */
export type Attachment = {
  type: 'attachment'
  id: string
  kind: 'image' | 'pdf' | 'text'
  name: string
  mime: string
  size: number
}

export type Block =
  | { type: 'text'; text: string }
  | Attachment
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown }
  | { type: 'thinking'; thinking?: string }
  | { type: string; [key: string]: unknown }

export type ChatMessage = {
  id: string
  seq: number
  role: 'user' | 'assistant'
  content: Block[]
  createdAt: string
  /** Written by the server for the model — the note that a proposed write was
   *  approved or declined — not typed by the person. Not drawn. */
  automatic?: boolean
}

/** `pending` is the only one the screen can act on: it is a write the
 *  assistant proposed and nobody has decided yet. */
export type ToolCallStatus = 'pending' | 'done' | 'approved' | 'denied' | 'failed'

export type ChatToolCall = {
  id: string
  messageId: string
  toolUseId: string
  name: string
  input: Record<string, unknown>
  status: ToolCallStatus
  result: unknown
  renderer: Renderer
  ms: number | null
}

export type Conversation = {
  id: string
  title: string
  subjectKind: 'customer' | 'opportunity' | null
  subjectId: string | null
  lastMessageAt: string
}

export type Thread = {
  conversation: Conversation & { ownerId: string; createdAt: string }
  messages: ChatMessage[]
  toolCalls: ChatToolCall[]
}

export function chatStatusQuery() {
  return queryOptions({
    queryKey: ['chat', 'status'],
    queryFn: () => api<{ enabled: boolean; attachments?: boolean }>('/chat/status'),
    /** Whether a key is configured does not change while somebody is looking
     *  at the screen, and the answer decides whether a button exists at all. */
    staleTime: 5 * 60 * 1000,
  })
}

export function conversationsQuery() {
  return queryOptions({
    queryKey: ['chat', 'list'],
    queryFn: () => api<Conversation[]>('/chat'),
  })
}

export function threadQuery(id: string | null) {
  return queryOptions({
    queryKey: ['chat', 'thread', id],
    queryFn: () => api<Thread>(`/chat/${id}`),
    enabled: id !== null,
  })
}

export function startConversation(body: {
  subjectKind?: 'customer' | 'opportunity'
  subjectId?: string
}) {
  return api<Conversation>('/chat', { method: 'POST', body })
}

export function deleteConversation(id: string) {
  return api<void>(`/chat/${id}`, { method: 'DELETE' })
}

/* ─────────────────────────────── Files ──────────────────────────────────── */

/** What the server accepts, repeated here only to fail fast: picking a 30 MB
 *  scan should say so at once, not after the upload. The server checks again
 *  from the bytes, and its answer is the one that counts. */
export const ATTACH_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.txt,.md,.csv'

export const ATTACH_MAX_PER_MESSAGE = 5

export function attachLimitFor(file: File): number {
  if (file.type.startsWith('image/')) return 5 * 1024 * 1024
  if (file.type === 'application/pdf') return 10 * 1024 * 1024
  return 256 * 1024
}

/** A phone photo made small enough to send, without losing anything the
 *  model would see.
 *
 *  The API scales every image down to about 1,568px on its long edge before
 *  the model looks at it, so a 12-megapixel photo is 4 MB of pixels thrown
 *  away on arrival — and over the 5 MB limit, which is where the first photo
 *  anybody tried from their phone ended up. Redrawn at 2,000px as a JPEG it is
 *  a few hundred kilobytes and reads the same.
 *
 *  Left alone when it is already within bounds (a screenshot keeps its crisp
 *  PNG text), when it is a GIF (redrawing would drop the animation), and when
 *  the browser cannot decode it — the server then says what is wrong. */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  const long = Math.max(bitmap.width, bitmap.height)
  if (long <= SHRINK_EDGE && file.size <= SHRINK_ABOVE) {
    bitmap.close()
    return file
  }

  const scale = Math.min(1, SHRINK_EDGE / long)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (!blob) return file

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}

const SHRINK_EDGE = 2000
const SHRINK_ABOVE = 1.5 * 1024 * 1024

export function uploadAttachment(threadId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<Attachment>(`/chat/${threadId}/attachments`, { method: 'POST', form })
}

/** A file's bytes as an object URL.
 *
 *  Fetched rather than linked: the session cookie goes cross-origin only on
 *  a request made with credentials, and an `<img src>` pointing at the API
 *  would depend on cookie rules the rest of the app does not. The caller
 *  revokes the URL when it is done with it. */
export async function attachmentUrl(threadId: string, id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/${threadId}/attachments/${id}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new ApiError(res.status, 'attachment_not_found')
  return URL.createObjectURL(await res.blob())
}

export function filesOf(message: ChatMessage): Attachment[] {
  return message.content.filter((block): block is Attachment => block.type === 'attachment')
}

/* ───────────────────────────── Reading a turn ───────────────────────────── */

/** The words in a turn, with the machinery left out.
 *
 *  A stored turn also holds `tool_use` blocks and the `tool_result` blocks the
 *  runner built between them. Neither is for reading: the first is drawn as a
 *  card from `toolCalls`, the second is the raw JSON the model saw. */
export function textOf(message: ChatMessage): string {
  return message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

/* ────────────────────────────── Streaming ──────────────────────────────── */

export type ChatEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; name: string; risk: 'auto' | 'ask' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

/** Sends a turn and reports what comes back as it comes back.
 *
 *  `fetch` rather than `EventSource`, which is GET-only — the message is a
 *  body, and a question somebody typed has no business in a URL that ends up
 *  in an access log.
 *
 *  Resolves when the stream closes. The caller refetches the thread then: the
 *  deltas are for watching, and the stored turn — with its ids, its tool
 *  results and whatever is waiting for approval — is the real record. */
export async function streamTurn(
  path: string,
  body: unknown,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  })

  if (!res.ok || !res.body) {
    const failed = await res.json().catch(() => null)
    throw new ApiError(res.status, readError(failed))
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    /** Frames are separated by a blank line, and a chunk can split one down
     *  the middle — so the tail stays in the buffer until its terminator
     *  arrives rather than being parsed as a short frame. */
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)) as ChatEvent)
      } catch {
        /* A frame we cannot read is one event lost, not a dead stream. */
      }
    }
  }
}

function readError(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'unexpected_response'
}
