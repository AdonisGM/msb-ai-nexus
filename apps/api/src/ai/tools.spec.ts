import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../auth/session.service'
import { CustomersService } from '../customers/customers.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ReportsService } from '../reports/reports.service'
import { SignalsService } from '../signals/signals.service'
import { TargetsService } from '../targets/targets.service'
import { UsersService } from '../users/users.service'
import { BLOCKER_CODES, PRODUCTS, signals, type User } from '../db/schema'
import { closeDb, resetDb, testDb } from '../test/db'
import { makeBranch, makeCustomer, makeOpportunity, makeUser } from '../test/factories'
import { buildTools, metaOf, runApproved, TOOL_META, type ToolSink } from './tools'

/** The assistant reaches the same data through the same services as a request
 *  does, so the rule that matters is that it reaches no further. These tests
 *  are mostly about that one property: a tool run as one salesperson must not
 *  return another's book, however the model phrases the arguments.
 *
 *  Nothing here calls Anthropic. The tools are plain functions; the model's
 *  only contribution is choosing which to call, and that is not what can go
 *  wrong with permissions. */

const sessions = new SessionService(testDb, {
  origins: ['http://localhost:5273'],
  cookieName: 'nexus_session',
  cookieSecure: false,
  sessionTtlMs: 1000,
  idleTimeoutMs: 0,
})

const services = {
  customers: new CustomersService(testDb),
  opportunities: new OpportunitiesService(testDb),
  signals: new SignalsService(testDb),
  reports: new ReportsService(testDb),
  users: new UsersService(testDb, sessions),
  targets: new TargetsService(testDb),
}

beforeEach(resetDb)
afterAll(closeDb)

/** The tools come back as SDK objects; this finds one and runs it the way the
 *  runner would, then parses the JSON the model would have seen. */
function toolset(user: User, sink: ToolSink = () => {}) {
  const tools = buildTools(services, user, sink)

  return async function call(name: string, input: Record<string, unknown> = {}) {
    const tool = tools.find((candidate) => candidate.name === name)
    if (!tool) throw new Error(`no tool named ${name}`)
    const text = await (tool as { run: (input: unknown) => Promise<string> }).run(input)
    return JSON.parse(text) as Record<string, unknown>
  }
}

/** Two salespeople under different team leads, each with a customer and a
 *  lead, so every scope assertion has something on the other side of the wall
 *  to fail against. */
async function branch() {
  const b = await makeBranch()

  const rbCustomer = await makeCustomer({
    ownerId: b.saleRb.id,
    segment: 'rb',
    name: 'Nguyễn Văn Khách',
  })
  const sseCustomer = await makeCustomer({
    ownerId: b.saleSse.id,
    segment: 'sse',
    name: 'Công ty Bên Kia',
  })

  const rbLead = await makeOpportunity({
    customerId: rbCustomer.id,
    ownerId: b.saleRb.id,
    segment: 'rb',
  })
  const sseLead = await makeOpportunity({
    customerId: sseCustomer.id,
    ownerId: b.saleSse.id,
    segment: 'sse',
  })

  return { ...b, rbCustomer, sseCustomer, rbLead, sseLead }
}

describe('the tools a salesperson gets', () => {
  it('searches only their own book', async () => {
    const b = await branch()
    const call = toolset(b.saleRb)

    const found = (await call('search_customers')) as { total: number; rows: { name: string }[] }
    expect(found.total).toBe(1)
    expect(found.rows[0].name).toBe('Nguyễn Văn Khách')
  })

  /** The id is real and the row exists — it is simply not theirs. Reported as
   *  not found rather than forbidden, because confirming a customer exists is
   *  already a leak. */
  it('cannot open a colleague’s customer by id', async () => {
    const b = await branch()
    const call = toolset(b.saleRb)

    const answer = await call('get_customer', { customerId: b.sseCustomer.id })
    expect(answer.error).toBeTruthy()
    expect(answer.name).toBeUndefined()
  })

  it('cannot open a colleague’s lead by id', async () => {
    const b = await branch()
    const call = toolset(b.saleRb)

    expect((await call('get_opportunity', { opportunityId: b.sseLead.id })).error).toBeTruthy()
  })

  it('cannot read a colleague’s signals', async () => {
    const b = await branch()
    const call = toolset(b.saleRb)

    expect((await call('get_customer_signals', { customerId: b.sseCustomer.id })).error).toBeTruthy()
  })

  /** The most tempting way round the wall: name somebody else in a filter the
   *  tool passes straight through. The scope still applies on top, so it
   *  narrows to nothing rather than widening. */
  it('gets nothing by naming another owner in a filter', async () => {
    const b = await branch()
    const call = toolset(b.saleRb)

    const found = (await call('search_opportunities', { ownerId: b.saleSse.id })) as {
      total: number
    }
    expect(found.total).toBe(0)
  })

  it('reports a funnel of only their own leads', async () => {
    const b = await branch()
    const call = toolset(b.saleRb)

    expect((await call('get_funnel')).leads).toBe(1)
  })
})

describe('the tools a manager gets', () => {
  it('lets a team lead see their own people and nobody else’s', async () => {
    const b = await branch()

    expect((await toolset(b.leadRb)('get_funnel')).leads).toBe(1)
    expect((await toolset(b.bm)('get_funnel')).leads).toBe(2)
  })

  it('lets a team lead open a lead belonging to their salesperson', async () => {
    const b = await branch()
    const answer = await toolset(b.leadRb)('get_opportunity', { opportunityId: b.rbLead.id })

    expect(answer.error).toBeUndefined()
    expect(answer.id).toBe(b.rbLead.id)
  })

  /** The org chart is deliberately not scoped the way records are — who your
   *  manager is, is not confidential inside a branch. */
  it('shows the whole branch tree to a salesperson', async () => {
    const b = await branch()
    const tree = (await toolset(b.saleRb)('get_org_tree')) as unknown as unknown[]

    expect(Array.isArray(tree)).toBe(true)
    expect(tree.length).toBeGreaterThan(0)
  })
})

describe('the three tools that stop the model guessing', () => {
  it('says who it is working for, and what they can see', async () => {
    const b = await branch()
    const me = await toolset(b.saleRb)('whoami')

    expect(me.id).toBe(b.saleRb.id)
    expect(me.role).toBe('sale')
    expect(me.scope).toContain('chính mình')
  })

  it('hands out today rather than letting the model invent it', async () => {
    const b = await branch()
    const now = (await toolset(b.saleRb)('today')) as unknown as {
      today: string
      thisMonth: { from: string; to: string }
      thisQuarter: { from: string }
    }

    /** Compared against the local date, not `toISOString()`.
     *
     *  Which is the bug this test caught in the tool in the first place: UTC
     *  is seven hours behind here, so between midnight and seven in the
     *  morning the two disagree — and an assertion written the wrong way round
     *  fails every night rather than never. */
    const local = new Date()
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
      local.getDate(),
    ).padStart(2, '0')}`

    expect(now.today).toBe(expected)
    /** Every window runs to today, not to the end of its own period — the same
     *  rule the dashboard's period picker follows. */
    expect(now.thisMonth.to).toBe(now.today)
    expect(now.thisMonth.from.endsWith('-01')).toBe(true)
    expect(now.thisQuarter.from.slice(5, 7)).toMatch(/01|04|07|10/)
  })

  it('hands out the real code lists, not a copy that can drift', async () => {
    const b = await branch()
    const codes = await toolset(b.saleRb)('list_codes')

    expect(codes.products).toEqual([...PRODUCTS])
    expect(codes.blockerCodes).toEqual([...BLOCKER_CODES])
  })
})

describe('what comes back', () => {
  /** Every row is paid for again on each later turn, so a search hands back a
   *  page and says plainly how much it is not showing. */
  it('caps a page and says what was left out', async () => {
    const b = await branch()
    for (let i = 0; i < 14; i++) {
      await makeOpportunity({
        customerId: b.rbCustomer.id,
        ownerId: b.saleRb.id,
        segment: 'rb',
      })
    }

    const found = (await toolset(b.saleRb)('search_opportunities')) as {
      total: number
      shown: number
      note: string
    }

    expect(found.total).toBe(15)
    expect(found.shown).toBe(10)
    expect(found.note).toContain('15')
  })

  /** A mistyped id should let the model try again, not end the conversation. */
  it('reports a failure to the model instead of throwing', async () => {
    const b = await branch()
    const calls: string[] = []
    const call = toolset(b.saleRb, (c) => calls.push(`${c.name}:${c.failed}`))

    const answer = await call('get_customer', { customerId: 'khong-ton-tai' })

    expect(answer.error).toBeTruthy()
    expect(calls).toEqual(['get_customer:true'])
  })

  /** The screen draws its charts from this, never from what the model wrote,
   *  so the object has to reach the caller intact. */
  it('hands the caller the object, not the JSON the model reads', async () => {
    const b = await branch()
    const seen: unknown[] = []
    await toolset(b.saleRb, (c) => seen.push(c.result))('get_funnel')

    expect(seen).toHaveLength(1)
    expect((seen[0] as { leads: number }).leads).toBe(1)
  })
})

describe('the tool register', () => {
  it('describes every tool that is built', async () => {
    const b = await branch()
    const names = buildTools(services, b.saleRb).map((tool) => tool.name)

    expect(names.sort()).toEqual(Object.keys(TOOL_META).sort())
  })

  /** Named exactly rather than counted, so a future tool that writes cannot be
   *  added as `auto` without this failing and somebody reading it. */
  it('asks about every write and about nothing else', () => {
    const asks = Object.entries(TOOL_META)
      .filter(([, meta]) => meta.risk === 'ask')
      .map(([name]) => name)
      .sort()

    expect(asks).toEqual([
      'draft_opportunity',
      'record_signal',
      'set_next_action',
      'update_lead_fields',
    ])
  })

  it('runs every read without asking', () => {
    for (const [name, meta] of Object.entries(TOOL_META)) {
      if (name.startsWith('get_') || name.startsWith('search_') || name.startsWith('list_')) {
        expect(meta.risk, name).toBe('auto')
      }
    }
  })

  /** A write tool must not touch the branch's data when the model calls it.
   *  It records the intent and says a person has been asked. */
  it('writes nothing when the assistant calls a write tool', async () => {
    const b = await branch()
    const seen: string[] = []
    const call = toolset(b.saleRb, (c) => seen.push(c.name))

    const answer = await call('record_signal', {
      customerId: b.rbCustomer.id,
      type: 'need',
      content: 'Khách hỏi vay mua nhà',
    })

    expect(answer.status).toBe('pending_approval')
    expect(seen).toEqual(['record_signal'])
    expect(await testDb.select().from(signals)).toHaveLength(0)
  })

  /** A name nobody declared is the most cautious thing it could be. Defaulting
   *  to `auto` would turn a future mistake into a silent write. */
  it('treats an unknown tool as one that must be asked about', () => {
    expect(metaOf('drop_everything').risk).toBe('ask')
  })
})

/** One person carries three identifiers and `whoami` hands back all of them,
 *  so the model has three ways to name the same colleague and picks the wrong
 *  one often enough to matter. What made it worth fixing is that the wrong one
 *  was not an error: the filter matched nothing, and the turn ended by telling
 *  a salesperson they had no leads at all. */
describe('naming somebody in a filter', () => {
  async function team() {
    const b = await makeBranch()
    const hai = await makeUser({
      unitId: b.unit.id,
      role: 'sale',
      segment: 'rb',
      managerId: b.leadRb.id,
      code: 'SALE-RB-09',
      employeeCode: 'NV0006',
      name: 'Hải',
    })
    const customer = await makeCustomer({ ownerId: hai.id, segment: 'rb' })
    await makeOpportunity({ customerId: customer.id, ownerId: hai.id, segment: 'rb' })
    return { ...b, hai }
  }

  it('takes the id', async () => {
    const b = await team()
    expect((await toolset(b.leadRb)('get_funnel', { ownerId: b.hai.id })).leads).toBe(1)
  })

  /** The payroll number, which is the one the model actually reached for. */
  it('takes the employee code', async () => {
    const b = await team()
    expect((await toolset(b.leadRb)('get_funnel', { ownerId: 'NV0006' })).leads).toBe(1)
  })

  it('takes the login code, whatever the case', async () => {
    const b = await team()
    expect((await toolset(b.leadRb)('get_funnel', { ownerId: 'sale-rb-09' })).leads).toBe(1)
  })

  it('takes a name when only one person answers to it', async () => {
    const b = await team()
    expect((await toolset(b.leadRb)('get_funnel', { ownerId: 'Hải' })).leads).toBe(1)
  })

  /** Two Hảis in a branch is ordinary. Picking either would be a wrong answer
   *  wearing the shape of a right one. */
  it('refuses a name two people share', async () => {
    const b = await team()
    await makeUser({
      unitId: b.unit.id,
      role: 'sale',
      segment: 'rb',
      managerId: b.leadRb.id,
      name: 'Hải',
    })

    const answer = await toolset(b.leadRb)('get_funnel', { ownerId: 'Hải' })
    expect(answer.error).toMatch(/get_org_tree/)
    expect(answer.leads).toBeUndefined()
  })

  /** The point of the whole exercise: say so, rather than hand back a report
   *  of zero that reads exactly like a quiet month. */
  it('fails loudly on something that names nobody', async () => {
    const b = await team()

    const answer = await toolset(b.leadRb)('get_funnel', { ownerId: 'NV9999' })
    expect(answer.error).toMatch(/get_org_tree/)
    expect(answer.leads).toBeUndefined()
  })

  /** Resolving an identifier is not permission to use it. The scope still
   *  runs on top, so a salesperson naming a colleague gets an empty report
   *  rather than their colleague's. */
  it('still refuses a colleague the caller may not see', async () => {
    const b = await team()

    const answer = await toolset(b.saleRb)('get_funnel', { ownerId: 'NV0006' })
    expect(answer.error).toBeUndefined()
    expect(answer.leads).toBe(0)
  })

  /** A person outside the caller's branch does not resolve at all — the org
   *  chart it reads is their own unit's. */
  it('does not resolve somebody from another branch', async () => {
    const b = await team()
    const stranger = await makeUser({ role: 'sale', name: 'Người Lạ' })

    const answer = await toolset(b.leadRb)('get_funnel', { ownerId: stranger.id })
    expect(answer.error).toMatch(/get_org_tree/)
  })

  it('reaches the searches too, not only the reports', async () => {
    const b = await team()

    const found = (await toolset(b.leadRb)('search_opportunities', { ownerId: 'NV0006' })) as {
      total: number
    }
    expect(found.total).toBe(1)
  })
})

/** The branch manager reads figures and never touches a record — the rule the
 *  business gave, mirrored on the web in `lib/can.ts` and enforced on every
 *  HTTP write by `@Roles('sale', 'team_lead')`.
 *
 *  It has to be enforced here too, and that is the whole point of these tests.
 *  The assistant does not go through a controller: `runApproved` calls the
 *  service directly, and the services check *scope* — may this person see this
 *  customer — not role. A branch manager can see every customer in their unit,
 *  so without the guard they could write through the assistant exactly what
 *  the API would have refused with a 403. */
describe('what a branch manager may do through the assistant', () => {
  const WRITES = ['record_signal', 'draft_opportunity', 'set_next_action', 'update_lead_fields']

  it('is not offered a single write tool', async () => {
    const b = await branch()
    const names = buildTools(services, b.bm).map((tool) => tool.name)

    for (const write of WRITES) expect(names, write).not.toContain(write)
    /** The reads are all still there — this is a write rule, not a mute. */
    expect(names).toContain('get_customer')
    expect(names).toContain('search_opportunities')
  })

  it('still writes nothing even if an approval arrives for one', async () => {
    const b = await branch()

    await expect(
      runApproved(services, b.bm, 'record_signal', {
        customerId: b.rbCustomer.id,
        type: 'need',
        content: 'Ghi hộ',
      }),
    ).rejects.toThrow()

    expect(await testDb.select().from(signals)).toHaveLength(0)
  })

  /** The approval comes back in a later request than the proposal, and the
   *  only thing linking them is a row in `tool_calls`. A call raised while the
   *  person was a team lead must not run once they are not. */
  it('refuses a call that was proposed before the role changed', async () => {
    const b = await branch()
    const wasLead = { ...b.leadRb, role: 'bm' as const }

    await expect(
      runApproved(services, wasLead, 'set_next_action', {
        opportunityId: b.rbLead.id,
        nextAction: 'Gọi lại',
      }),
    ).rejects.toThrow()
  })

  it('leaves the write tools with everybody who does have them', async () => {
    const b = await branch()

    for (const user of [b.saleRb, b.leadRb]) {
      const names = buildTools(services, user).map((tool) => tool.name)
      for (const write of WRITES) expect(names, `${user.role}/${write}`).toContain(write)
    }
  })

  /** The admin passes every role gate on the server too — a technical account
   *  that still lands in the audit trail. */
  it('leaves them with the admin as well', async () => {
    const b = await branch()
    const admin = { ...b.bm, role: 'admin' as const }
    const names = buildTools(services, admin).map((tool) => tool.name)

    for (const write of WRITES) expect(names, write).toContain(write)
  })
})
