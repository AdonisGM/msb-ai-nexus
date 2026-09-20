import { BadRequestException, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** The model is cut out of these tests on purpose.
 *
 *  Without this they pass or fail depending on whether whoever is running them
 *  happens to have a key in `.env` — which is not a property of the code. Worse,
 *  they passed for the wrong reason before a key existed: `decide` threw on its
 *  way to Anthropic, and the assertions read a database that had already been
 *  written. Now the throw is deliberate and the assertions mean what they say.
 *
 *  What is being tested is the gate: did the write happen, for whom, once. The
 *  continuation afterwards is the model's, and it is exercised against the real
 *  thing rather than against a stub that would only prove the stub works. */
vi.mock('./claude', () => ({
  AI_ENABLED: false,
  MODEL: 'test-model',
  TITLE_MODEL: 'test-title-model',
  THINKING: { type: 'adaptive' },
  OUTPUT_CONFIG: { effort: 'medium' },
  claude: () => {
    throw new Error('ai_not_configured')
  },
}))
import { SessionService } from '../auth/session.service'
import { CustomersService } from '../customers/customers.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ReportsService } from '../reports/reports.service'
import { SignalsService } from '../signals/signals.service'
import { TargetsService } from '../targets/targets.service'
import { UsersService } from '../users/users.service'
import { conversations, messages, signals, toolCalls } from '../db/schema'
import { closeDb, resetDb, testDb } from '../test/db'
import {
  makeBranch,
  makeConversation,
  makeCustomer,
  makeMessage,
  makeToolCall,
} from '../test/factories'
import { ChatService, hashOf } from './chat.service'

/** A conversation is somebody's working notes, not a branch record.
 *
 *  That is the whole of what these tests are about. The row scope that governs
 *  customers deliberately does not apply here: a team lead may read every lead
 *  their people hold and still has no business reading what one of them typed
 *  into an assistant. Ownership is the only rule, and it has to hold on every
 *  way in.
 *
 *  Nothing here talks to Anthropic. `send` is the one method that does, and
 *  what it adds on top of these — the loop, the persistence of a turn — is
 *  exercised against the real thing rather than against a stub that would only
 *  prove the stub works. */

const sessions = new SessionService(testDb, {
  origins: ['http://localhost:5273'],
  cookieName: 'nexus_session',
  cookieSecure: false,
  sessionTtlMs: 1000,
  idleTimeoutMs: 0,
})

const service = new ChatService(
  testDb,
  new CustomersService(testDb),
  new OpportunitiesService(testDb),
  new SignalsService(testDb),
  new ReportsService(testDb),
  new UsersService(testDb, sessions),
  new TargetsService(testDb),
)

beforeEach(resetDb)
afterAll(closeDb)

describe('whose conversation it is', () => {
  it('lists only the threads a person started', async () => {
    const b = await makeBranch()
    await makeConversation({ ownerId: b.saleRb.id, title: 'của Hải' })
    await makeConversation({ ownerId: b.saleSse.id, title: 'của Hà' })

    const mine = await service.list(b.saleRb)
    expect(mine).toHaveLength(1)
    expect(mine[0].title).toBe('của Hải')
  })

  /** Not forbidden — missing. Confirming a thread exists is already a leak,
   *  the same reasoning the customer and lead reads follow. */
  it('hides a colleague’s thread behind a 404', async () => {
    const b = await makeBranch()
    const theirs = await makeConversation({ ownerId: b.saleSse.id })

    await expect(service.get(b.saleRb, theirs.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  /** A team lead reads every lead their people hold. Their notes are still
   *  not branch records. */
  it('hides a salesperson’s thread from their own team lead', async () => {
    const b = await makeBranch()
    const theirs = await makeConversation({ ownerId: b.saleRb.id })

    await expect(service.get(b.leadRb, theirs.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.get(b.bm, theirs.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('refuses to delete a thread that is not yours', async () => {
    const b = await makeBranch()
    const theirs = await makeConversation({ ownerId: b.saleSse.id })

    await expect(service.remove(b.saleRb, theirs.id)).rejects.toBeInstanceOf(NotFoundException)
    expect(await testDb.select().from(conversations)).toHaveLength(1)
  })
})

describe('starting one', () => {
  it('starts a thread about nothing in particular', async () => {
    const b = await makeBranch()
    const thread = await service.start(b.saleRb, {})

    expect(thread.ownerId).toBe(b.saleRb.id)
    expect(thread.subjectKind).toBeNull()
    /** Named after the first exchange, not before it. */
    expect(thread.title).toBe('')
  })

  /** Anchored to a record so reopening the assistant from a customer file
   *  comes back to the same thread rather than a blank one. */
  it('anchors a thread to what it is about', async () => {
    const b = await makeBranch()
    const thread = await service.start(b.saleRb, {
      subjectKind: 'customer',
      subjectId: 'cus_1',
    })

    expect(thread.subjectKind).toBe('customer')
    expect(thread.subjectId).toBe('cus_1')
  })
})

describe('reading one back', () => {
  it('returns the turns in order, with the tool calls beside them', async () => {
    const b = await makeBranch()
    const thread = await makeConversation({ ownerId: b.saleRb.id })
    await makeMessage({ conversationId: thread.id, seq: 1, role: 'user' })
    const answer = await makeMessage({ conversationId: thread.id, seq: 2, role: 'assistant' })
    await makeToolCall({
      conversationId: thread.id,
      messageId: answer.id,
      name: 'get_funnel',
      result: { leads: 42 },
    })

    const read = await service.get(b.saleRb, thread.id)

    expect(read.messages.map((m) => m.seq)).toEqual([1, 2])
    expect(read.toolCalls).toHaveLength(1)
    expect(read.toolCalls[0].result).toEqual({ leads: 42 })
  })

  /** The web draws a chart from the result, and it should not have to know
   *  which component goes with which tool. */
  it('says how each tool result should be drawn', async () => {
    const b = await makeBranch()
    const thread = await makeConversation({ ownerId: b.saleRb.id })
    const answer = await makeMessage({ conversationId: thread.id, role: 'assistant' })

    await makeToolCall({ conversationId: thread.id, messageId: answer.id, name: 'get_monthly' })
    await makeToolCall({ conversationId: thread.id, messageId: answer.id, name: 'whoami' })

    const read = await service.get(b.saleRb, thread.id)
    const byName = new Map(read.toolCalls.map((call) => [call.name, call.renderer]))

    expect(byName.get('get_monthly')).toBe('trend.monthly')
    /** Some answers are prose. Drawing a chart of "who am I" would be worse
     *  than saying it. */
    expect(byName.get('whoami')).toBeNull()
  })
})

describe('deleting one', () => {
  it('takes the turns and the tool calls with it', async () => {
    const b = await makeBranch()
    const thread = await makeConversation({ ownerId: b.saleRb.id })
    const turn = await makeMessage({ conversationId: thread.id, role: 'assistant' })
    await makeToolCall({ conversationId: thread.id, messageId: turn.id })

    await service.remove(b.saleRb, thread.id)

    expect(await testDb.select().from(conversations)).toHaveLength(0)
    expect(await testDb.select().from(messages)).toHaveLength(0)
    expect(await testDb.select().from(toolCalls)).toHaveLength(0)
  })

  it('leaves everyone else’s threads alone', async () => {
    const b = await makeBranch()
    const mine = await makeConversation({ ownerId: b.saleRb.id })
    await makeConversation({ ownerId: b.saleSse.id })

    await service.remove(b.saleRb, mine.id)

    const left = await testDb.select().from(conversations)
    expect(left).toHaveLength(1)
    expect(left[0].ownerId).toBe(b.saleSse.id)
  })
})

/** Used to pair a tool_use block with the result that came back, and — once
 *  the write tools arrive — to bind an approval to the arguments a person
 *  actually read. Both jobs break if the same call hashes two ways. */
describe('identifying a call by its arguments', () => {
  it('ignores the order the keys came in', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }))
  })

  it('separates two calls that differ in one value', () => {
    expect(hashOf({ id: 'OPP-1' })).not.toBe(hashOf({ id: 'OPP-2' }))
  })

  /** An approval for "set the due date to the 26th" must not cover a run that
   *  also quietly changes the amount. */
  it('separates a call that carries an extra argument', () => {
    expect(hashOf({ id: 'OPP-1' })).not.toBe(hashOf({ id: 'OPP-1', value: 5 }))
  })

  it('reads an absent argument the same as an omitted one', () => {
    expect(hashOf({ id: 'OPP-1', note: undefined })).toBe(hashOf({ id: 'OPP-1' }))
  })

  it('keeps nested arguments in order', () => {
    expect(hashOf({ f: { x: 1, y: 2 } })).toBe(hashOf({ f: { y: 2, x: 1 } }))
    expect(hashOf({ f: [1, 2] })).not.toBe(hashOf({ f: [2, 1] }))
  })
})

/** The approval gate.
 *
 *  `decide` is the one method on this service that does real work without the
 *  model: it runs the write, or it does not. Everything below is about the
 *  four ways that can be got wrong — running twice, running for somebody who
 *  should not, running something out of scope, and running after everyone has
 *  forgotten what they agreed to.
 *
 *  Each test stops before the continuation, which needs Anthropic. What the
 *  assertion reads is the row and the branch's data — which is the part that
 *  matters, because that is where a mistaken approval would land. */
describe('deciding a proposed write', () => {
  async function proposed(overrides: Record<string, unknown> = {}) {
    const b = await makeBranch()
    const customer = await makeCustomer({ ownerId: b.saleRb.id, segment: 'rb' })
    const thread = await makeConversation({ ownerId: b.saleRb.id })
    const turn = await makeMessage({ conversationId: thread.id, role: 'assistant' })

    const call = await makeToolCall({
      conversationId: thread.id,
      messageId: turn.id,
      name: 'record_signal',
      status: 'pending',
      input: {
        customerId: customer.id,
        type: 'need',
        content: 'Khách hỏi vay 2 tỷ mua nhà',
      },
      ...overrides,
    })

    return { ...b, customer, thread, call }
  }

  /** Approval runs the tool for real. The assistant asked; the person is the
   *  one who wrote it. */
  it('writes only once a person has said yes', async () => {
    const p = await proposed()

    expect(await testDb.select().from(signals)).toHaveLength(0)

    await expect(
      service.decide(p.saleRb, p.thread.id, p.call.id, true),
    ).rejects.toThrow(/ai_not_configured|AI/i)

    /** The write happened before the thread tried to continue, which is the
     *  order that matters: the model being unreachable must not lose a record
     *  the person already approved. */
    const written = await testDb.select().from(signals)
    expect(written).toHaveLength(1)
    expect(written[0].content).toBe('Khách hỏi vay 2 tỷ mua nhà')
    expect(written[0].authorId).toBe(p.saleRb.id)
  })

  it('marks the row with who decided it and when', async () => {
    const p = await proposed()
    await service.decide(p.saleRb, p.thread.id, p.call.id, true).catch(() => null)

    const [row] = await testDb.select().from(toolCalls).where(eq(toolCalls.id, p.call.id))
    expect(row.status).toBe('approved')
    expect(row.decidedById).toBe(p.saleRb.id)
    expect(row.decidedAt).not.toBeNull()
    expect(row.result).not.toBeNull()
  })

  it('writes nothing when the person declines', async () => {
    const p = await proposed()
    await service.decide(p.saleRb, p.thread.id, p.call.id, false, 'Khách chưa xác nhận').catch(
      () => null,
    )

    expect(await testDb.select().from(signals)).toHaveLength(0)

    const [row] = await testDb.select().from(toolCalls).where(eq(toolCalls.id, p.call.id))
    expect(row.status).toBe('denied')
    expect(row.note).toBe('Khách chưa xác nhận')
    expect(row.result).toBeNull()
  })

  /** Single use. A row already decided is not a second licence, however the
   *  button is pressed. */
  it('refuses a second decision on the same row', async () => {
    const p = await proposed()
    await service.decide(p.saleRb, p.thread.id, p.call.id, true).catch(() => null)

    await expect(
      service.decide(p.saleRb, p.thread.id, p.call.id, true),
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(await testDb.select().from(signals)).toHaveLength(1)
  })

  it('refuses to decide a call in somebody else’s thread', async () => {
    const p = await proposed()

    await expect(
      service.decide(p.saleSse, p.thread.id, p.call.id, true),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect(await testDb.select().from(signals)).toHaveLength(0)
  })

  /** The gap between proposing and approving can be minutes, and a lead can
   *  change hands in them — so the scope is checked when the write runs, not
   *  when it was suggested. */
  it('still refuses a write the person may not make', async () => {
    const b = await makeBranch()
    const theirs = await makeCustomer({ ownerId: b.saleSse.id, segment: 'sse' })
    const thread = await makeConversation({ ownerId: b.saleRb.id })
    const turn = await makeMessage({ conversationId: thread.id, role: 'assistant' })
    const call = await makeToolCall({
      conversationId: thread.id,
      messageId: turn.id,
      name: 'record_signal',
      status: 'pending',
      input: { customerId: theirs.id, type: 'need', content: 'không phải sổ của tôi' },
    })

    await service.decide(b.saleRb, thread.id, call.id, true).catch(() => null)

    expect(await testDb.select().from(signals)).toHaveLength(0)

    const [row] = await testDb.select().from(toolCalls).where(eq(toolCalls.id, call.id))
    expect(row.status).toBe('failed')
  })

  /** An approval is a person saying "yes, now" about arguments they have just
   *  read. Half an hour later they have forgotten what the card said. */
  it('expires an approval nobody got round to', async () => {
    const p = await proposed()
    await testDb
      .update(toolCalls)
      .set({ createdAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(toolCalls.id, p.call.id))

    await expect(
      service.decide(p.saleRb, p.thread.id, p.call.id, true),
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(await testDb.select().from(signals)).toHaveLength(0)
  })

  it('does not know a call id from another thread', async () => {
    const p = await proposed()
    const other = await makeConversation({ ownerId: p.saleRb.id })

    await expect(
      service.decide(p.saleRb, other.id, p.call.id, true),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
