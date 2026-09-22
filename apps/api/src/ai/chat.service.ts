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
  type Attachment,
  type Conversation,
  type User,
} from '../db/schema'
import { CustomersService } from '../customers/customers.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ReportsService } from '../reports/reports.service'
import { SignalsService } from '../signals/signals.service'
import { TargetsService } from '../targets/targets.service'
import { UsersService } from '../users/users.service'
import { propagateAttributes, startActiveObservation, startObservation } from '@langfuse/tracing'
import { claude, MODEL, OUTPUT_CONFIG, THINKING, TITLE_MODEL } from './claude'
import { LANGFUSE_ENABLED } from './tracing'
import { usageFor } from './usage'
import { systemPrompt, TITLE_PROMPT } from './prompt'
import { metaOf, requestTools, runApproved, type ToolSink } from './tools'
import { AttachmentsService, refOf, type UploadedFile } from './attachments.service'
import { filesToLoad, replay, todayInVietnam, type ClockRef, type ContextRef } from './replay'
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
  /** A piece of the summary of what the model is weighing before it answers.
   *  Shown faded while nothing else is arriving, dropped once words do. */
  | { kind: 'thinking'; delta: string }
  /** A tool the assistant reached for. `ask` ones never ran — they are
   *  waiting for the person, and the card will say so. */
  | { kind: 'tool'; name: string; risk: 'auto' | 'ask' }
  /** The turn is over and stored. Carries the whole thread so the screen
   *  replaces its optimistic copy with the real one, ids and all. */
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export type Emit = (event: ChatEvent) => void

/** A ceiling on the tool loop.
 *
 *  Not a cost control — it is there so a model that misreads a result and asks
 *  the same question again cannot do it forever while somebody waits. */
const MAX_ITERATIONS = 12

const MAX_TOKENS = 8192

/** Cache diagnostics: the API compares each request's prompt with the one
 *  named as the previous and says where they diverged — model, system, tools
 *  or messages — and roughly how many tokens that cost. It only works if every
 *  request carries the header, so it is on all of them. */
const CACHE_DIAGNOSIS_BETA = 'cache-diagnosis-2026-04-07'

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
  /** The last response id per thread, for cache diagnostics to compare
   *  against. In memory on purpose: it is a debugging aid, a restart only
   *  costs one comparison per thread, and it is not worth a column.
   *
   *  Compared per turn, not per loop iteration. Pointing each iteration at
   *  the one before would mean `runner.setMessagesParams` mid-loop — and the
   *  runner reads that as the caller taking over the history: it stops
   *  appending the model's reply and sends the same request again, up to
   *  `max_iterations`. That shipped for one evening, lost every answer and
   *  burned the credit balance re-sending a PDF twelve times. Do not. */
  private readonly lastResponse = new Map<string, string>()

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly opportunities: OpportunitiesService,
    private readonly signals: SignalsService,
    private readonly reports: ReportsService,
    private readonly users: UsersService,
    private readonly targets: TargetsService,
    private readonly attachments: AttachmentsService,
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
        /** Written by `decide`, not typed. The approval card already says what
         *  was decided; drawn as a bubble it would repeat that, with the raw
         *  result JSON attached, in the person's own voice. */
        automatic: turn.role === 'user' && isDecisionTurn(turn.content),
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

    /** Best effort. A store that is down should not keep a thread somebody
     *  asked to delete on their screen; the bytes left behind are unreachable
     *  once the rows are gone, and are the cheaper of the two failures. */
    await this.attachments.purge(id).catch(() => undefined)

    await this.db.delete(conversations).where(eq(conversations.id, id))
  }

  /** Keeps a file for the next message in a thread. */
  async upload(user: User, id: string, file: UploadedFile) {
    const conversation = await this.own(user, id)
    return this.attachments.upload(conversation, user, file)
  }

  /** A file from a thread, through its owner like everything else here. */
  async download(user: User, id: string, attachmentId: string) {
    const conversation = await this.own(user, id)
    return this.attachments.read(conversation, attachmentId)
  }

  /** Says one thing and runs the loop until the assistant stops asking for
   *  tools. */
  async send(user: User, id: string, body: SendMessageDto, emit?: Emit) {
    const conversation = await this.own(user, id)

    const text = body.text ?? ''
    const files = await this.attachments.claim(conversation, user, body.attachmentIds ?? [])

    /** A file on its own is a message — "here is the contract" needs no
     *  words. Nothing at all is not. */
    if (text === '' && files.length === 0) throw new BadRequestException('text_required')

    const context = body.contextKind
      ? await this.contextOf(user, body.contextKind, body.contextId!)
      : null

    /** The date and the record on screen go ahead of the words. */
    const preface: Array<ClockRef | ContextRef> = [
      { type: 'clock', date: todayInVietnam() },
      ...(context ? [context] : []),
    ]

    await this.turn(user, conversation, { role: 'user', content: text }, emit, files, preface)

    if (conversation.title === '') {
      await this.nameThread(user, conversation.id)
    }

    return this.get(user, id)
  }

  /** The record on screen, read through the person's own scope.
   *
   *  A record they cannot see is a 404 here exactly as it is on its own page,
   *  so an id pasted from somewhere else cannot put another salesperson's
   *  customer into the model's context — or confirm that it exists. The label
   *  comes from the row, never from the browser. */
  private async contextOf(
    user: User,
    kind: 'customer' | 'opportunity',
    id: string,
  ): Promise<ContextRef> {
    if (kind === 'customer') {
      const customer = await this.customers.get(user, id)
      return { type: 'context', kind, id, label: `"${customer.name}" (${customer.code})` }
    }
    const deal = await this.opportunities.get(user, id)
    return {
      type: 'context',
      kind,
      id,
      label: `${deal.code} của khách "${deal.customerName}"`,
    }
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
    const said = decisionText(call.name, approve, failed, result, note)

    await this.turn(user, conversation, { role: 'user', content: said }, emit)

    return this.get(user, id)
  }

  /* ─────────────────────────────── Inside ──────────────────────────────── */

  /** One pass of the loop: say something, let the assistant work, store what
   *  came out. Shared by an ordinary message and by a decision, because from
   *  the model's side the two are the same thing — a person said something. */
  private async turn(
    user: User,
    conversation: Conversation,
    said: Turn,
    emit?: Emit,
    files: Attachment[] = [],
    preface: Array<ClockRef | ContextRef> = [],
  ) {
    /** One trace per turn, with the person and the thread on it, so a run can
     *  be found later by who asked rather than by a request id nobody kept.
     *
     *  A no-op when Langfuse is not configured — `propagateAttributes` still
     *  runs the callback, and the spans inside simply go nowhere. */
    if (!LANGFUSE_ENABLED) return this.runTurn(user, conversation, said, emit, files, preface)

    return propagateAttributes(
      {
        userId: user.id,
        sessionId: conversation.id,
        tags: [user.role, emit ? 'stream' : 'blocking'],
      },
      () =>
        /** A span around the whole turn, so a trace opens on the question and
         *  the answer rather than on a row of token counts. The per-request
         *  generations and each tool call nest inside it.
         *
         *  Sending the words at all is a decision the self-hosted stack makes
         *  safe: they carry customer names and notes a salesperson typed, and
         *  on somebody else's cloud they would have no business leaving this
         *  machine. On your own, a trace without them is a bill without an
         *  itemisation — you can see what a turn cost and never why. */
        startActiveObservation('chat', async (span) => {
          span.update({ input: textOfTurn(said) })
          const answer = await this.runTurn(user, conversation, said, emit, files, preface)
          span.update({ output: answer })
          return answer
        }),
    )
  }

  private async runTurn(
    user: User,
    conversation: Conversation,
    said: Turn,
    emit?: Emit,
    files: Attachment[] = [],
    preface: Array<ClockRef | ContextRef> = [],
  ) {
    /** The turn as it is stored: the date, the screen's context and the files
     *  by reference, ahead of the words — the order the API reads documents
     *  best in. The bytes and the notes are swapped in by `replay`, for this
     *  request only.
     *
     *  A decision turn has no preface and stays a plain string, which is how
     *  `isDecisionTurn` recognises it. */
    const stored: Turn = files.length || preface.length
      ? {
          role: 'user',
          content: [
            ...preface,
            ...files.map(refOf),
            /** A file sent without words has an empty text block, which the
             *  API refuses outright. */
            ...normalise(said.content).filter((block) => block.type !== 'text' || block.text !== ''),
          ] as Block[],
        }
      : said

    const rows = [...(await this.history(conversation.id)), stored]
    const sent = replay(rows, await this.attachments.blocks(filesToLoad(rows)))

    /** Collected as the tools run rather than dug out afterwards, because the
     *  SDK hands the model a JSON string and keeps nothing of the object the
     *  screen needs. */
    const ran: Parameters<ToolSink>[0][] = []
    const sink: ToolSink = (call) => {
      ran.push(call)
      emit?.({ kind: 'tool', name: call.name, risk: metaOf(call.name).risk })

      /** One span per tool, with what it was asked and what came back. This is
       *  what makes a trace worth opening: the token counts say a turn was
       *  expensive, these say which read made it so — and whether the model
       *  was reaching for the right thing at all. */
      if (LANGFUSE_ENABLED) {
        startObservation(`tool:${call.name}`, {
          input: call.input,
          output: call.result,
          metadata: { risk: metaOf(call.name).risk, ms: call.ms, failed: call.failed },
        }).end()
      }
    }

    const runner = claude().beta.messages.toolRunner({
      model: MODEL,
      betas: [CACHE_DIAGNOSIS_BETA],
      diagnostics: { previous_message_id: this.lastResponse.get(conversation.id) ?? null },
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
      messages: sent,
      /** The fourth breakpoint, and the one that moves: the API puts it on
       *  the last block of every request, so each loop iteration and each
       *  later turn reads the conversation so far from cache instead of paying
       *  full price for it. Without it only the tools, the system prompt and
       *  the newest file were cached, and a four-call question re-sent its
       *  growing history four times at list price. */
      cache_control: { type: 'ephemeral' },
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
        stream.on('thinking', (delta) => emit({ kind: 'thinking', delta }))
        const message = await stream.finalMessage()
        record(message, [...runner.params.messages])
        this.lastResponse.set(conversation.id, message.id)
      }
    } else {
      /** Iterated rather than `runUntilDone()`, because each iteration is one
       *  request and its `usage` is what that request cost. Waiting for the
       *  runner to finish hands back only the last message, and the loop's
       *  other two go unmeasured. */
      for await (const message of runner as AsyncIterable<Anthropic.Beta.Messages.BetaMessage>) {
        record(message, [...runner.params.messages])
        this.lastResponse.set(conversation.id, message.id)
      }
    }

    /** Everything the runner added: the assistant turns and the tool-result
     *  turns it built between them. Sliced off the end rather than rebuilt,
     *  so what is stored is exactly what the model was sent. */
    const produced = runner.params.messages.slice(sent.length) as Turn[]

    const [saidId] = await this.persist(conversation, [stored, ...produced], ran)
    await this.attachments.link(
      files.map((file) => file.id),
      saidId,
    )

    return produced.map(textOfTurn).filter(Boolean).join('\n\n')
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

  /** The thread as stored. What the model sees of it is `replay`'s call. */
  private async history(conversationId: string): Promise<Turn[]> {
    const rows = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.seq))

    return rows as Turn[]
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

      /** Small, but billed like any other request — left out, it was one of
       *  the gaps between what Langfuse showed and what the invoice said. */
      if (LANGFUSE_ENABLED) {
        startObservation(
          'title',
          { model: reply.model, input: transcript, usageDetails: usageFor(reply.usage) },
          { asType: 'generation' },
        ).end()
      }

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

/** What the assistant is told after a person decides a proposed write.
 *
 *  Kept beside `isDecisionTurn` so the two cannot drift: the screen hides
 *  these turns by recognising the words, and a reworded template that the
 *  matcher missed would put raw JSON back in a bubble. */
export function decisionText(
  name: string,
  approve: boolean,
  failed: boolean,
  result: unknown,
  note?: string,
): string {
  if (!approve) {
    return `${DECLINED} "${name}".${note ? ` Lý do: ${note}` : ''} Đừng đề xuất lại việc này trừ khi tôi yêu cầu.`
  }
  if (failed) {
    return `${APPROVED} "${name}" nhưng hệ thống từ chối: ${JSON.stringify(result)}. Đừng thử lại cùng cách.`
  }
  /** A search wrote nothing, and its result is somebody else's page. Said
   *  so, because "đã ghi xong" would have the model treat a news article as
   *  a record in the system. */
  if (name === 'search_web') {
    return `${APPROVED} "${name}". Kết quả tìm trên mạng — nguồn bên ngoài, chưa kiểm chứng, không phải số liệu của ngân hàng. Trả lời dựa trên kết quả này và nêu nguồn: ${JSON.stringify(result)}`
  }
  if (name === 'fetch_url') {
    return `${APPROVED} "${name}". Nội dung trang web — nguồn bên ngoài, chưa kiểm chứng, không phải số liệu của ngân hàng. Trả lời dựa trên nội dung này và nêu đường link: ${JSON.stringify(result)}`
  }
  return `${APPROVED} "${name}". Hệ thống đã ghi xong: ${JSON.stringify(result)}`
}

const APPROVED = 'Tôi đã duyệt'
const DECLINED = 'Tôi không duyệt'

export function isDecisionTurn(content: unknown): boolean {
  const blocks = normalise(content as Turn['content'])
  if (blocks.length !== 1 || blocks[0].type !== 'text') return false
  return new RegExp(`^(${APPROVED}|${DECLINED}) "[a-z_]+"`).test(blocks[0].text)
}

/** A turn's content is either a string the caller typed or a list of blocks.
 *  Stored as blocks either way, so everything downstream has one shape. */
/** The words in a turn, for a trace to open on. The tool plumbing is left out
 *  — it has its own spans. */
function textOfTurn(turn: Turn): string {
  return normalise(turn.content)
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlockParam => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

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
function record(message: Anthropic.Beta.Messages.BetaMessage, sent: Turn[]): void {
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
      /** Everything the request carried and everything it returned. On a
       *  self-hosted instance there is no reason to hold any of it back, and
       *  a trace you cannot read the prompt of is a trace you cannot use to
       *  improve the prompt.
       *
       *  `sent` is the runner's own message array, which it mutates as it
       *  goes. The two iterators disagree about when the reply lands in it:
       *  the streaming one yields before the response exists, the plain one
       *  may have appended it already. Dropping a trailing assistant turn
       *  settles both, and it can only ever be this reply — mid-loop the
       *  array never ends on an assistant turn otherwise, because the runner
       *  only keeps going when the last reply asked for a tool, and it
       *  appends the result as a user turn before asking again. */
      input: withoutFileBytes(sent.at(-1)?.role === 'assistant' ? sent.slice(0, -1) : sent),
      output: {
        content: message.content,
        stop_reason: message.stop_reason,
      },
      /** Why the cache missed, when it did — `messages_changed` with a token
       *  count is ordinary growth, `tools_changed` or `system_changed` is a
       *  prefix somebody broke. Null when it hit, or when the comparison was
       *  still running as the response went out. */
      metadata: {
        cacheMiss:
          (message as { diagnostics?: { cache_miss_reason?: unknown } | null }).diagnostics
            ?.cache_miss_reason ?? null,
      },
      modelParameters: {
        thinking: THINKING.type,
        effort: OUTPUT_CONFIG.effort,
        max_tokens: MAX_TOKENS,
      },
      usageDetails: usageFor(usage),
    },
    { asType: 'generation' },
  ).end()
}

/** The request as a trace should hold it: every word, but no file bytes.
 *
 *  A five-page PDF is a few megabytes of base64 in every generation of every
 *  loop, and a trace is for reading what was asked and what came back — the
 *  file's name says which one it was. */
function withoutFileBytes(turns: Turn[]): Turn[] {
  return turns.map((turn) =>
    typeof turn.content === 'string'
      ? turn
      : {
          ...turn,
          content: turn.content.map((block) =>
            (block.type === 'image' || block.type === 'document') && block.source.type === 'base64'
              ? ({
                  ...block,
                  source: { ...block.source, data: `[${block.source.data.length} ký tự base64]` },
                } as Block)
              : block,
          ),
        },
  )
}
