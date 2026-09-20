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

export type Block =
  | { type: 'text'; text: string }
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
    queryFn: () => api<{ enabled: boolean }>('/chat/status'),
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
