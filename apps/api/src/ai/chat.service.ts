import { createHash, randomUUID } from 'node:crypto'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type Anthropic from '@anthropic-ai/sdk'
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module'
import {
  conversations,
  messages,
  toolCalls,
  type Conversation,
  type User,
} from '../db/schema'
import { CustomersService } from '../customers/customers.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ReportsService } from '../reports/reports.service'
import { SignalsService } from '../signals/signals.service'
import { TargetsService } from '../targets/targets.service'
import { UsersService } from '../users/users.service'
import { propagateAttributes, startObservation } from '@langfuse/tracing'
import { claude, MODEL, OUTPUT_CONFIG, THINKING, TITLE_MODEL } from './claude'
import { LANGFUSE_ENABLED } from './tracing'
import { systemPrompt, TITLE_PROMPT } from './prompt'
import { metaOf, requestTools, runApproved, type ToolSink } from './tools'
import type { SendMessageDto, StartConversationDto } from './dto'

type Block = Anthropic.Beta.Messages.BetaContentBlockParam
type Turn = Anthropic.Beta.Messages.BetaMessageParam

/** What the screen is told while a turn is still running.
 *
 *  Deliberately narrow. The loop produces a great deal — thinking blocks,
 *  partial tool inputs, message boundaries — and almost none of it is
 *  something a salesperson wants to watch. What is worth sending is the words
 *  as they arrive and the name of whatever the assistant is reading, because
 *  those are the two things that answer "is it stuck". */
export type ChatEvent =
  | { kind: 'text'; delta: string }
  /** A tool the assistant reached for. `ask` ones never ran — they are
   *  waiting for the person, and the card will say so. */
  | { kind: 'tool'; name: string; risk: 'auto' | 'ask' }
  /** The turn is over and stored. Carries the whole thread so the screen
   *  replaces its optimistic copy with the real one, ids and all. */
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export type Emit = (event: ChatEvent) => void

/** How many exchanges keep their tool results in full when a thread is
 *  replayed.
 *
 *  A tool result can be twenty-five rows of a report, and every turn after it
 *  pays for those rows again. Older ones are replaced by a one-line stand-in —
 *  the block stays, because the API refuses an assistant turn whose `tool_use`
 *  has no matching `tool_result`, but its contents go. The assistant keeps the
 *  thread of the conversation and loses the raw data it has already used. */
const REPLAY_TURNS = 3

/** A ceiling on the tool loop.
 *
 *  Not a cost control — it is there so a model that misreads a result and asks
 *  the same question again cannot do it forever while somebody waits. */
const MAX_ITERATIONS = 12

const MAX_TOKENS = 8192

/** How long a proposed write stays approvable.
 *
 *  An approval is a person saying "yes, now" about arguments they have just
 *  read. Half an hour later the lead may have moved, the figure may be stale,
 *  and the person has almost certainly forgotten what the card said. Expiring
 *  costs one more exchange; not expiring means a button that writes something
 *  nobody remembers agreeing to. */
const APPROVAL_TTL_MS = 30 * 60 * 1000

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly opportunities: OpportunitiesService,
    private readonly signals: SignalsService,
    private readonly reports: ReportsService,
    private readonly users: UsersService,
    private readonly targets: TargetsService,
  ) {}

  /** A person's threads, newest first.
   *
   *  Scoped by ownership and nothing else. A conversation is somebody's
   *  working notes, not a branch record: two salespeople asking about the same
   *  customer are having two different conversations, and a team lead has no
   *  more business reading one than reading a colleague's notebook. */
  async list(user: User) {
    return this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        subjectKind: conversations.subjectKind,
        subjectId: conversations.subjectId,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(eq(conversations.ownerId, user.id))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(50)
  }

  /** One thread, with everything the screen needs to draw it.
   *
   *  Tool calls come back beside the messages rather than inside them: the
   *  chat renders a chart from `result`, and digging it out of a content block
   *  on every render would put the shape of the SDK into the web app. */
  async get(user: User, id: string) {
    const conversation = await this.own(user, id)

    const [turns, calls] = await Promise.all([
      this.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(asc(messages.seq)),
      this.db
        .select()
        .from(toolCalls)
        .where(eq(toolCalls.conversationId, id))
        .orderBy(asc(toolCalls.createdAt)),
    ])

    return {
      conversation,
      messages: turns.map((turn) => ({
        id: turn.id,
        seq: turn.seq,
        role: turn.role,
        content: turn.content,
        createdAt: turn.createdAt,
      })),
      toolCalls: calls.map((call) => ({
        id: call.id,
        messageId: call.messageId,
        toolUseId: call.toolUseId,
        name: call.name,
        input: call.input,
        status: call.status,
        result: call.result,
        renderer: metaOf(call.name).renderer,
        ms: call.ms,
      })),
    }
  }

  async start(user: User, body: StartConversationDto): Promise<Conversation> {
    const [row] = await this.db
      .insert(conversations)
      .values({
        id: randomUUID(),
        ownerId: user.id,
        subjectKind: body.subjectKind ?? null,
        subjectId: body.subjectId ?? null,
      })
      .returning()

    return row
  }

  async remove(user: User, id: string): Promise<void> {
    await this.own(user, id)
    await this.db.delete(conversations).where(eq(conversations.id, id))
  }

  /** Says one thing and runs the loop until the assistant stops asking for
   *  tools. */
  async send(user: User, id: string, body: SendMessageDto, emit?: Emit) {
    const conversation = await this.own(user, id)
    await this.turn(user, conversation, { role: 'user', content: body.text }, emit)

    if (conversation.title === '') {
      await this.nameThread(user, conversation.id)
    }

    return this.get(user, id)
  }

  /** Approves or declines a write the assistant proposed.
   *
   *  Approving runs the tool for real, now, through the same service and the
   *  same person — so the scope is checked at the moment of the write, not at
   *  the moment it was suggested. Declining runs nothing.
   *
   *  Either way the thread continues with a new turn saying what the person
   *  decided. The "waiting for approval" result already in the transcript is
   *  left exactly as it was: it is what happened, and rewriting it so the
   *  history reads tidier would be the one edit nobody should be able to make
   *  to a record of who agreed to what. */
  async decide(
    user: User,
    id: string,
    callId: string,
    approve: boolean,
    note?: string,
    emit?: Emit,
  ) {
    const conversation = await this.own(user, id)

    const [call] = await this.db
      .select()
      .from(toolCalls)
      .where(and(eq(toolCalls.id, callId), eq(toolCalls.conversationId, conversation.id)))
      .limit(1)

    if (!call) throw new NotFoundException('tool_call_not_found')

    /** Single use. A row that has already been decided is not a second
     *  licence, however the button is pressed. */
    if (call.status !== 'pending') throw new BadRequestException('tool_call_already_decided')

    if (Date.now() - call.createdAt.getTime() > APPROVAL_TTL_MS) {
      await this.db
        .update(toolCalls)
        .set({ status: 'failed', note: 'Quá hạn duyệt' })
        .where(eq(toolCalls.id, call.id))
      throw new BadRequestException('tool_call_expired')
    }

    let result: unknown = null
    let failed = false

    if (approve) {
      const started = Date.now()
      try {
        result = await runApproved(
          this.services(),
          user,
          call.name,
          call.input as Record<string, unknown>,
        )
      } catch (error) {
        failed = true
        result = { error: error instanceof Error ? error.message : String(error) }
      }

      await this.db
        .update(toolCalls)
        .set({
          status: failed ? 'failed' : 'approved',
          result: result as Record<string, unknown>,
          note: note ?? null,
          decidedById: user.id,
          decidedAt: new Date(),
          ms: Date.now() - started,
        })
        .where(eq(toolCalls.id, call.id))
    } else {
      await this.db
        .update(toolCalls)
        .set({
          status: 'denied',
          note: note ?? null,
          decidedById: user.id,
          decidedAt: new Date(),
        })
        .where(eq(toolCalls.id, call.id))
    }

    /** Told to the assistant as a plain turn rather than smuggled in as a
     *  tool_result, because that is what it is: the person came back and said
     *  something. A denial has to reach the model too, or it proposes the same
     *  write again on the next question. */
    const said = approve
      ? failed
        ? `Tôi đã duyệt "${call.name}" nhưng hệ thống từ chối: ${JSON.stringify(result)}. Đừng thử lại cùng cách.`
        : `Tôi đã duyệt "${call.name}". Hệ thống đã ghi xong: ${JSON.stringify(result)}`
      : `Tôi không duyệt "${call.name}".${note ? ` Lý do: ${note}` : ''} Đừng đề xuất lại việc này trừ khi tôi yêu cầu.`

    await this.turn(user, conversation, { role: 'user', content: said }, emit)

    return this.get(user, id)
  }

  /* ─────────────────────────────── Inside ──────────────────────────────── */

  /** One pass of the loop: say something, let the assistant work, store what
   *  came out. Shared by an ordinary message and by a decision, because from
   *  the model's side the two are the same thing — a person said something. */
  private async turn(user: User, conversation: Conversation, said: Turn, emit?: Emit) {
    /** One trace per turn, with the person and the thread on it, so a run can
     *  be found later by who asked rather than by a request id nobody kept.
     *
     *  A no-op when Langfuse is not configured — `propagateAttributes` still
     *  runs the callback, and the spans inside simply go nowhere. */
    if (!LANGFUSE_ENABLED) return this.runTurn(user, conversation, said, emit)

    return propagateAttributes(
      {
        userId: user.id,
        sessionId: conversation.id,
        tags: [user.role, emit ? 'stream' : 'blocking'],
      },
      () => this.runTurn(user, conversation, said, emit),
    )
  }

  private async runTurn(user: User, conversation: Conversation, said: Turn, emit?: Emit) {
    const history = await this.history(conversation.id)

    /** Collected as the tools run rather than dug out afterwards, because the
     *  SDK hands the model a JSON string and keeps nothing of the object the
     *  screen needs. */
    const ran: Parameters<ToolSink>[0][] = []
    const sink: ToolSink = (call) => {
      ran.push(call)
      emit?.({ kind: 'tool', name: call.name, risk: metaOf(call.name).risk })
    }

    const runner = claude().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: THINKING,
      output_config: OUTPUT_CONFIG,
      /** A block rather than a string, so it can carry a cache breakpoint.
       *
       *  Two breakpoints in all: one inside `requestTools` on the last loaded
       *  tool, and this one. The first caches the definitions, which are
       *  identical for everybody in the branch; this one extends the cached
       *  prefix through the system prompt, which carries a name and so is one
       *  entry per person. Without them the same ~9,600 tokens were sent on
       *  every request of every loop. */
      system: [
        {
          type: 'text',
          text: systemPrompt(user),
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: requestTools(this.services(), user, sink),
      messages: [...history, said],
      max_iterations: MAX_ITERATIONS,
      /** Streaming only when somebody is watching. The approval continuation
       *  and any future background use take the plain path, where a single
       *  await is simpler than a loop that discards every delta. */
      ...(emit ? { stream: true as const } : {}),
    })

    if (emit) {
      /** Each iteration of a streaming runner yields a stream, not a message —
       *  the deltas are read off it, and `finalMessage` waits for that
       *  iteration to close before the loop moves on to the tools. */
      for await (const stream of runner as AsyncIterable<BetaMessageStream>) {
        stream.on('text', (delta) => emit({ kind: 'text', delta }))
        record(await stream.finalMessage())
      }
    } else {
      /** Iterated rather than `runUntilDone()`, because each iteration is one
       *  request and its `usage` is what that request cost. Waiting for the
       *  runner to finish hands back only the last message, and the loop's
       *  other two go unmeasured. */
      for await (const message of runner as AsyncIterable<Anthropic.Beta.Messages.BetaMessage>) {
        record(message)
      }
    }

    /** Everything the runner added: the assistant turns and the tool-result
     *  turns it built between them. Sliced off the end rather than rebuilt,
     *  so what is stored is exactly what the model was sent. */
    const produced = runner.params.messages.slice(history.length + 1) as Turn[]

    await this.persist(conversation, [said, ...produced], ran)
  }

  private services() {
    return {
      customers: this.customers,
      opportunities: this.opportunities,
      signals: this.signals,
      reports: this.reports,
      users: this.users,
      targets: this.targets,
    }
  }

  /** The thread as the model should see it again.
   *
   *  Older tool results are hollowed out on the way (see `REPLAY_TURNS`). */
  private async history(conversationId: string): Promise<Turn[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.seq))

    const keepFrom = Math.max(0, rows.length - REPLAY_TURNS * 2)

    return rows.map((row, index) => {
      const content = row.content as Block[] | string
      if (index >= keepFrom || typeof content === 'string') {
        return { role: row.role as 'user' | 'assistant', content } as Turn
      }

      return {
        role: row.role as 'user' | 'assistant',
        content: content.map((block) =>
          block.type === 'tool_result'
            ? { ...block, content: '[kết quả cũ, đã lược bớt để tiết kiệm ngữ cảnh]' }
            : block,
        ),
      } as Turn
    })
  }

  /** Writes the turns and the tool calls, and moves the thread's clock. */
  private async persist(
    conversation: Conversation,
    turns: Turn[],
    ran: Parameters<ToolSink>[0][],
  ) {
    /** What the tools actually returned, keyed the way a `tool_use` block can
     *  be looked up: by name and by the exact arguments. A queue per key, so
     *  two identical calls in one turn take their own results rather than
     *  sharing the first. */
    const byCall = new Map<string, Parameters<ToolSink>[0][]>()
    for (const call of ran) {
      const key = `${call.name}:${hashOf(call.input)}`
      const queue = byCall.get(key)
      if (queue) queue.push(call)
      else byCall.set(key, [call])
    }

    const [{ last }] = await this.db
      .select({ last: sql<number>`coalesce(max(${messages.seq}), 0)::int` })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))

    let seq = Number(last)
    const written: string[] = []

    for (const turn of turns) {
      seq += 1
      const id = randomUUID()
      const content = normalise(turn.content)

      await this.db.insert(messages).values({
        id,
        conversationId: conversation.id,
        seq,
        role: turn.role,
        content,
      })
      written.push(id)

      for (const block of content) {
        if (block.type !== 'tool_use') continue

        const key = `${block.name}:${hashOf(block.input)}`
        const call = byCall.get(key)?.shift()

        /** A write did not run — it asked. It is stored waiting for a person,
         *  with no result, which is the state the approval card is drawn from
         *  and the only state `decide` will act on. */
        const waiting = metaOf(block.name).risk === 'ask'

        await this.db.insert(toolCalls).values({
          id: randomUUID(),
          conversationId: conversation.id,
          messageId: id,
          toolUseId: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
          inputHash: hashOf(block.input),
          status: waiting ? 'pending' : call?.failed ? 'failed' : 'done',
          result: waiting ? null : ((call?.result ?? null) as Record<string, unknown> | null),
          ms: waiting ? null : (call?.ms ?? null),
        })
      }
    }

    await this.db
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversation.id))

    return written
  }

  /** Names the thread from its first exchange.
   *
   *  A failure here is swallowed on purpose: an untitled conversation is a
   *  cosmetic problem, and letting it take down an answer the person is
   *  waiting for would be the wrong trade. */
  private async nameThread(user: User, conversationId: string) {
    try {
      /** Read back from the table rather than passed in, because by now the
       *  turn has been stored and the table is the one version of it. */
      const rows = await this.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.seq))
        .limit(6)

      const transcript = rows
        .map((row) => {
          const text = normalise(row.content as Block[])
            .filter((block): block is Anthropic.Beta.Messages.BetaTextBlockParam =>
              block.type === 'text',
            )
            .map((block) => block.text)
            .join(' ')
          return text ? `${row.role === 'user' ? user.name : 'Trợ lý'}: ${text}` : ''
        })
        .filter(Boolean)
        .join('\n')
        .slice(0, 1500)

      if (!transcript) return

      const reply = await claude().messages.create({
        model: TITLE_MODEL,
        max_tokens: 64,
        system: TITLE_PROMPT,
        messages: [{ role: 'user', content: transcript }],
      })

      const title = reply.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
        .trim()
        .slice(0, 80)

      if (title) {
        await this.db
          .update(conversations)
          .set({ title })
          .where(eq(conversations.id, conversationId))
      }
    } catch {
      /* A thread with no title still opens and still answers. */
    }
  }

  /** Reads a thread through its owner, so somebody else's id is a 404 rather
   *  than a 403 — the same rule the rest of the API follows, for the same
   *  reason: confirming a record exists is already a leak. */
  private async own(user: User, id: string): Promise<Conversation> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.ownerId, user.id)))
      .limit(1)

    if (!row) throw new NotFoundException('conversation_not_found')
    return row
  }
}

/** A turn's content is either a string the caller typed or a list of blocks.
 *  Stored as blocks either way, so everything downstream has one shape. */
function normalise(content: Turn['content']): Block[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : (content as Block[])
}

/** Identifies a call by its exact arguments.
 *
 *  Used twice: to pair a `tool_use` block with the result the sink recorded,
 *  and — once the write tools arrive — to bind an approval to the arguments a
 *  person actually read, so approving one thing is not a licence to run
 *  another. Keys are sorted so `{a,b}` and `{b,a}` hash alike. */
export function hashOf(input: unknown): string {
  return createHash('sha256').update(stable(input)).digest('hex').slice(0, 32)
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)

  return `{${entries.join(',')}}`
}

/** One span per request the loop made, carrying what it cost.
 *
 *  Per request, not per turn: a question that needs three tool calls is three
 *  billed requests, and a single total would hide the one that ran away. The
 *  cache figures are the point of the exercise — they are how anybody can tell
 *  whether the two breakpoints are still working after a prompt is edited. */
function record(message: Anthropic.Beta.Messages.BetaMessage): void {
  if (!LANGFUSE_ENABLED) return

  const usage = message.usage as {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }

  startObservation(
    'chat-turn',
    {
      model: message.model,
      output: { stop_reason: message.stop_reason },
      usageDetails: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
    },
    { asType: 'generation' },
  ).end()
}

