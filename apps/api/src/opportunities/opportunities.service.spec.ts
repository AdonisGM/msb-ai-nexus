import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  auditEvents,
  opportunities,
  opportunityProducts,
  users,
  type Opportunity,
} from '../db/schema'
import { closeDb, resetDb, testDb } from '../test/db'
import { makeBranch, makeCustomer, makeUser } from '../test/factories'
import { OpportunitiesService } from './opportunities.service'

const service = new OpportunitiesService(testDb)

beforeEach(resetDb)
afterAll(closeDb)

/** A branch with one retail customer on Hải's book — the scenario from the
 *  brief, and the shape every test here needs. */
async function scene() {
  const branch = await makeBranch()
  const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
  return { ...branch, customerId: customer.id }
}

type Scene = Awaited<ReturnType<typeof scene>>

async function aLead(s: Scene, value = 2_000_000_000): Promise<Opportunity> {
  return service.create(s.saleRb, {
    customerId: s.customerId,
    product: 'loan',
    need: 'Buy a home',
    value,
  })
}

/** A lead walked down to wherever the test needs it, by the person who owns
 *  it. Going through the service rather than the factory matters here: these
 *  tests are about what the service writes on the way. */
async function walk(s: Scene, id: string, ...steps: Array<'contact' | 'advise'>) {
  let row: Opportunity | undefined
  for (const step of steps) row = await service.act(s.saleRb, id, step)
  return row!
}

const SOLD = [{ product: 'card', amount: 0 }, { product: 'od', amount: 500_000_000 }]

async function trace(id: string) {
  return testDb
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.opportunityId, id))
    .orderBy(asc(auditEvents.seq))
}

describe('create', () => {
  it('starts a lead untouched, whoever typed it in', async () => {
    const s = await scene()
    const lead = await aLead(s)

    expect(lead.stage).toBe('new')
    expect(lead.outcome).toBe('open')
    expect(lead.contactedAt).toBeNull()
    expect(lead.ownerId).toBe(s.saleRb.id)
    expect(lead.code).toMatch(/^OPP-\d{4}-0001$/)
  })

  /** Every report filters on segment; a lead that disagreed with its customer
   *  would land in numbers nobody reviews. */
  it('takes the segment and the owner from the customer, not the caller', async () => {
    const s = await scene()
    const lead = await service.create(s.leadRb, {
      customerId: s.customerId,
      product: 'card',
      need: 'Wants a credit card',
      value: 50_000_000,
    })

    expect(lead.segment).toBe('rb')
    expect(lead.ownerId).toBe(s.saleRb.id)
  })

  /** The reason this column exists rather than being derived from whoever
   *  owns the lead today: a salesperson transferring branches in October would
   *  otherwise carry every deal they closed in September out of one branch's
   *  report and into another's, and re-running September would print a
   *  different number than it did in September. */
  it('stamps the lead with the branch that raised it', async () => {
    const s = await scene()
    const lead = await aLead(s)
    expect(lead.unitId).toBe(s.unit.id)
  })

  it('keeps that branch even after the owner moves to another one', async () => {
    const s = await scene()
    const lead = await aLead(s)
    const elsewhere = await makeBranch()

    await testDb
      .update(users)
      .set({ unitId: elsewhere.unit.id, managerId: elsewhere.leadRb.id })
      .where(eq(users.id, s.saleRb.id))

    const [after] = await testDb
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, lead.id))
    expect(after.unitId).toBe(s.unit.id)
  })

  it('marks where the lead came in from', async () => {
    const s = await scene()
    const typed = await aLead(s)
    const pushed = await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'card',
      need: 'Campaign list',
      value: 50_000_000,
      source: 'import',
    })

    expect(typed.source).toBe('manual')
    expect(pushed.source).toBe('import')
  })

  it('numbers leads in sequence within the year', async () => {
    const s = await scene()
    const first = await aLead(s)
    const second = await aLead(s)

    const year = new Date().getFullYear()
    expect(first.code).toBe(`OPP-${year}-0001`)
    expect(second.code).toBe(`OPP-${year}-0002`)
  })

  it('refuses a customer the caller cannot see', async () => {
    const s = await scene()
    const stranger = await makeUser({ role: 'sale', segment: 'sse' })

    await expect(
      service.create(stranger, {
        customerId: s.customerId,
        product: 'loan',
        need: 'Buy a home',
        value: 1_000_000_000,
      }),
    ).rejects.toThrow(NotFoundException)
  })

  it('opens the trail with a single untimed entry', async () => {
    const s = await scene()
    const lead = await aLead(s)
    const rows = await trace(lead.id)

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('created')
    expect(rows[0].seq).toBe(1)
    expect(rows[0].heldMs).toBeNull()
  })
})

describe('walking the funnel', () => {
  it('records the first call and the advice as separate marks', async () => {
    const s = await scene()
    const lead = await aLead(s)

    const called = await service.act(s.saleRb, lead.id, 'contact')
    expect(called.stage).toBe('contacted')
    expect(called.contactedAt).not.toBeNull()
    expect(called.advisedAt).toBeNull()

    const advised = await service.act(s.saleRb, lead.id, 'advise')
    expect(advised.stage).toBe('advised')
    expect(advised.advisedAt).not.toBeNull()
  })

  /** A lead rung again next week is still a lead first rung today. Moving the
   *  mark would quietly shrink every "how long until someone called them"
   *  figure the branch reports. */
  it('never moves the first-contact mark once it is set', async () => {
    const s = await scene()
    const lead = await aLead(s)

    const called = await service.act(s.saleRb, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'advise')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })
    await service.act(s.leadRb, lead.id, 'reopen', { reason: 'Wrong customer' })
    const again = await service.act(s.saleRb, lead.id, 'win', {
      reason: 'Corrected and signed',
      products: SOLD,
    })

    expect(again.contactedAt?.getTime()).toBe(called.contactedAt?.getTime())
  })

  /** Reopening leaves the lead where the conversation got to, so the steps
   *  already taken are not on offer again — there is nothing to re-advise. */
  it('does not replay steps the lead has already been through', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact', 'advise')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })
    await service.act(s.leadRb, lead.id, 'reopen', { reason: 'Wrong customer' })

    const reopened = await service.get(s.saleRb, lead.id)
    expect(reopened.actions.map((a) => a.action)).toEqual(['win', 'lose'])
  })

  it('refuses a step the lead has no room for', async () => {
    const s = await scene()
    const lead = await aLead(s)

    /** Advising before calling. */
    await expect(service.act(s.saleRb, lead.id, 'advise')).rejects.toThrow(ConflictException)

    await service.act(s.saleRb, lead.id, 'contact')
    /** Calling twice. */
    await expect(service.act(s.saleRb, lead.id, 'contact')).rejects.toThrow(ConflictException)
  })

  it('rejects an action that does not exist', async () => {
    const s = await scene()
    const lead = await aLead(s)

    await expect(
      service.act(s.saleRb, lead.id, 'escalate' as never),
    ).rejects.toThrow(BadRequestException)
  })

  it('writes one trail row per step, each timed from the last', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact', 'advise')

    const rows = await trace(lead.id)
    expect(rows.map((row) => row.kind)).toEqual(['created', 'contacted', 'advised'])
    expect(rows[0].heldMs).toBeNull()
    expect(rows[1].heldMs).not.toBeNull()
    expect(rows[2].heldMs).not.toBeNull()
  })
})

describe('recording a result', () => {
  it('counts a win the moment the salesperson records it, with nobody signing', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact', 'advise')

    const won = await service.act(s.saleRb, lead.id, 'win', {
      reason: 'Disbursed on the 12th',
      products: SOLD,
    })

    expect(won.outcome).toBe('won')
    expect(won.closedAt).not.toBeNull()
    expect(won.outcomeReason).toBe('Disbursed on the 12th')
    /** The figure stands on its own. Reconciliation comes later, or not. */
    expect(won.confirmedAt).toBeNull()
  })

  it('lands a deal straight off the first call', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await service.act(s.saleRb, lead.id, 'contact')

    const won = await service.act(s.saleRb, lead.id, 'win', {
      reason: 'Signed on the call',
      products: [{ product: 'card', amount: 0 }],
    })

    expect(won.stage).toBe('contacted')
    expect(won.outcome).toBe('won')
  })

  it('will not record a result on a lead nobody has called', async () => {
    const s = await scene()
    const lead = await aLead(s)

    await expect(
      service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD }),
    ).rejects.toThrow(ConflictException)
  })

  it('demands a reason for a win and for a loss', async () => {
    const s = await scene()
    const won = await aLead(s)
    const lost = await aLead(s)
    await walk(s, won.id, 'contact')
    await walk(s, lost.id, 'contact')

    await expect(
      service.act(s.saleRb, won.id, 'win', { products: SOLD }),
    ).rejects.toThrow(BadRequestException)
    await expect(service.act(s.saleRb, lost.id, 'lose', {})).rejects.toThrow(BadRequestException)
    await expect(
      service.act(s.saleRb, lost.id, 'lose', { reason: '   ' }),
    ).rejects.toThrow(BadRequestException)
  })

  /** The branch counts cards, overdrafts and loans in separate columns. A win
   *  that names none of them lands in the total and in no column, and the two
   *  halves of the report stop adding up. */
  it('will not record a win that sold nothing', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')

    await expect(
      service.act(s.saleRb, lead.id, 'win', { reason: 'Signed' }),
    ).rejects.toThrow(BadRequestException)
    await expect(
      service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: [] }),
    ).rejects.toThrow(BadRequestException)
  })

  it('stores what was sold, one row per product', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    const sold = await service.get(s.saleRb, lead.id)
    expect(sold.products.map((row) => row.product)).toEqual(['card', 'od'])
    expect(sold.products.find((row) => row.product === 'od')?.amount).toBe(500_000_000)
    /** A fee-free card is a real sale the branch counts. */
    expect(sold.products.find((row) => row.product === 'card')?.amount).toBe(0)
  })

  it('keeps the expected value apart from what actually sold', async () => {
    const s = await scene()
    const lead = await aLead(s, 2_000_000_000)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', {
      reason: 'Signed for less',
      products: [{ product: 'loan', amount: 1_200_000_000 }],
    })

    const sold = await service.get(s.saleRb, lead.id)
    expect(sold.value).toBe(2_000_000_000)
    expect(sold.products[0].amount).toBe(1_200_000_000)
  })

  it('records a loss with its reason and nothing sold', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact', 'advise')

    const lost = await service.act(s.saleRb, lead.id, 'lose', {
      reason: 'Went with VCB on rate',
      blockerCode: 'rate',
    })

    expect(lost.outcome).toBe('lost')
    expect(lost.blockerCode).toBe('rate')
    expect(await testDb.select().from(opportunityProducts)).toHaveLength(0)
  })

  it('has nothing left to press once a lead has landed', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    const won = await service.get(s.saleRb, lead.id)
    expect(won.actions).toEqual([])
  })
})

describe('who may press what', () => {
  it("lets nobody touch another salesperson's lead", async () => {
    const s = await scene()
    const lead = await aLead(s)

    /** The SSE salesperson cannot even see it, so it reads as gone rather
     *  than as forbidden: telling someone a record exists but is not theirs
     *  is already a leak. */
    await expect(service.act(s.saleSse, lead.id, 'contact')).rejects.toThrow(NotFoundException)
  })

  it('refuses a team lead the funnel moves on their own people', async () => {
    const s = await scene()
    const lead = await aLead(s)

    await expect(service.act(s.leadRb, lead.id, 'contact')).rejects.toThrow(ForbiddenException)
  })

  /** The reconciliation is a second pair of eyes. A salesperson signing their
   *  own win is the whole control gone. */
  it('refuses a salesperson the signature on their own win', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    await expect(service.act(s.saleRb, lead.id, 'confirm')).rejects.toThrow(ForbiddenException)
  })

  it("refuses another team lead's signature", async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    await expect(service.act(s.leadSse, lead.id, 'confirm')).rejects.toThrow(NotFoundException)
  })

  it('refuses the branch manager any button at all', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    await expect(service.act(s.bm, lead.id, 'confirm')).rejects.toThrow(ForbiddenException)
    expect((await service.get(s.bm, lead.id)).actions).toEqual([])
  })

  /** A technical account that can unstick a demo. The trail still records who
   *  actually did it. */
  it('lets the admin act, under their own name', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const lead = await aLead(s)

    await service.act(admin, lead.id, 'contact')
    const rows = await trace(lead.id)
    expect(rows[1].actorId).toBe(admin.id)
  })
})

describe('the reconciliation', () => {
  async function aWonLead(s: Scene) {
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact', 'advise')
    return service.act(s.saleRb, lead.id, 'win', { reason: 'Disbursed', products: SOLD })
  }

  it('records who checked the paperwork, when, and what they found', async () => {
    const s = await scene()
    const won = await aWonLead(s)

    const signed = await service.act(s.leadRb, won.id, 'confirm', {
      reason: 'Matches the signed application',
    })

    expect(signed.confirmedById).toBe(s.leadRb.id)
    expect(signed.confirmedAt).not.toBeNull()
    expect(signed.confirmNote).toBe('Matches the signed application')
  })

  /** The point of the whole redesign: the signature is a check, not a gate. */
  it('changes no figure the branch reports', async () => {
    const s = await scene()
    const won = await aWonLead(s)
    const signed = await service.act(s.leadRb, won.id, 'confirm')

    expect(signed.outcome).toBe(won.outcome)
    expect(signed.stage).toBe(won.stage)
    expect(signed.closedAt?.getTime()).toBe(won.closedAt?.getTime())
    expect(await testDb.select().from(opportunityProducts)).toHaveLength(2)
  })

  it('signs a loss as readily as a win', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'lose', { reason: 'Lost on rate' })

    const signed = await service.act(s.leadRb, lead.id, 'confirm')
    expect(signed.confirmedById).toBe(s.leadRb.id)
  })

  it('will not sign a lead still being worked', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')

    await expect(service.act(s.leadRb, lead.id, 'confirm')).rejects.toThrow(ConflictException)
  })

  it('will not sign the same lead twice', async () => {
    const s = await scene()
    const won = await aWonLead(s)
    await service.act(s.leadRb, won.id, 'confirm')

    await expect(service.act(s.leadRb, won.id, 'confirm')).rejects.toThrow(ConflictException)
  })
})

describe('reopening', () => {
  async function aWonLead(s: Scene) {
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact', 'advise')
    return service.act(s.saleRb, lead.id, 'win', { reason: 'Disbursed', products: SOLD })
  }

  it('puts the lead back where the conversation left off', async () => {
    const s = await scene()
    const won = await aWonLead(s)

    const open = await service.act(s.leadRb, won.id, 'reopen', { reason: 'Wrong customer' })

    expect(open.outcome).toBe('open')
    expect(open.stage).toBe('advised')
    expect(open.closedAt).toBeNull()
    expect(open.outcomeReason).toBeNull()
    /** The calls already made still happened. */
    expect(open.contactedAt).not.toBeNull()
  })

  /** Leaving the product rows behind would keep the lead in the branch's card
   *  and overdraft counts while its own outcome says it sold nothing. */
  it('takes what was sold back out of the branch count', async () => {
    const s = await scene()
    const won = await aWonLead(s)
    expect(await testDb.select().from(opportunityProducts)).toHaveLength(2)

    await service.act(s.leadRb, won.id, 'reopen', { reason: 'Recorded against the wrong lead' })
    expect(await testDb.select().from(opportunityProducts)).toHaveLength(0)
  })

  it('demands a reason, and refuses the salesperson', async () => {
    const s = await scene()
    const won = await aWonLead(s)

    await expect(service.act(s.leadRb, won.id, 'reopen', {})).rejects.toThrow(BadRequestException)
    await expect(
      service.act(s.saleRb, won.id, 'reopen', { reason: 'Mistake' }),
    ).rejects.toThrow(ForbiddenException)
  })

  /** Reopening a signed-off lead would quietly withdraw a figure somebody put
   *  their name to. */
  it('refuses a lead that has already been signed off', async () => {
    const s = await scene()
    const won = await aWonLead(s)
    await service.act(s.leadRb, won.id, 'confirm')

    await expect(
      service.act(s.leadRb, won.id, 'reopen', { reason: 'Changed my mind' }),
    ).rejects.toThrow(ConflictException)
  })

  it('lets the lead be won again, replacing what it sold', async () => {
    const s = await scene()
    const won = await aWonLead(s)
    await service.act(s.leadRb, won.id, 'reopen', { reason: 'Wrong products' })

    await service.act(s.saleRb, won.id, 'win', {
      reason: 'Corrected',
      products: [{ product: 'usl', amount: 300_000_000 }],
    })

    const sold = await service.get(s.saleRb, won.id)
    expect(sold.products.map((row) => row.product)).toEqual(['usl'])
  })
})

describe('editing', () => {
  it('records a before and after for what changed, and nothing for what did not', async () => {
    const s = await scene()
    const lead = await aLead(s, 2_000_000_000)

    await service.update(s.saleRb, lead.id, { value: 2_500_000_000, reason: 'Revised upward' })

    const rows = await trace(lead.id)
    expect(rows).toHaveLength(2)
    expect(rows[1].kind).toBe('edited')
    expect(rows[1].changes).toEqual({ value: [2_000_000_000, 2_500_000_000] })
    expect(rows[1].reason).toBe('Revised upward')
  })

  it('writes nothing when the edit changes nothing', async () => {
    const s = await scene()
    const lead = await aLead(s, 2_000_000_000)

    await service.update(s.saleRb, lead.id, { value: 2_000_000_000 })
    expect(await trace(lead.id)).toHaveLength(1)
  })

  /** A landed deal is a reported figure. Correcting one means reopening it
   *  first, which leaves a trace. */
  it('refuses to edit a lead that has already landed', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    await expect(
      service.update(s.saleRb, lead.id, { value: 9_000_000_000 }),
    ).rejects.toThrow(ConflictException)
  })
})

describe('handing a lead over', () => {
  it('moves the owner and records who moved it', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const taker = await makeUser({
      role: 'sale',
      segment: 'rb',
      managerId: s.leadRb.id,
      unitId: s.unit.id,
    })
    const lead = await aLead(s)

    const moved = await service.assign(admin, lead.id, taker.id)
    expect(moved.ownerId).toBe(taker.id)

    const rows = await trace(lead.id)
    expect(rows[1].kind).toBe('assigned')
    expect(rows[1].changes).toEqual({ ownerId: [s.saleRb.id, taker.id] })
    expect(rows[1].actorId).toBe(admin.id)
  })

  it('refuses anyone but the admin', async () => {
    const s = await scene()
    const lead = await aLead(s)

    await expect(service.assign(s.leadRb, lead.id, s.saleRb.id)).rejects.toThrow(ForbiddenException)
    await expect(service.assign(s.bm, lead.id, s.saleRb.id)).rejects.toThrow(ForbiddenException)
  })

  /** A retail lead in an SSE book would be counted under the wrong segment on
   *  every report that splits the two. */
  it('refuses a recipient in the other segment', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const lead = await aLead(s)

    await expect(service.assign(admin, lead.id, s.saleSse.id)).rejects.toThrow(BadRequestException)
  })

  /** Handing a lead across branches would leave it counted in one branch's
   *  report while being worked in another. That restatement is not something
   *  this build does, so the move is refused rather than half-done. */
  it('refuses a recipient in another branch', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const elsewhere = await makeBranch()
    const lead = await aLead(s)

    await expect(service.assign(admin, lead.id, elsewhere.saleRb.id)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('refuses a recipient who has left', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const gone = await makeUser({
      role: 'sale',
      segment: 'rb',
      unitId: s.unit.id,
      managerId: s.leadRb.id,
      active: false,
    })
    const lead = await aLead(s)

    await expect(service.assign(admin, lead.id, gone.id)).rejects.toThrow(BadRequestException)
  })

  it('refuses a recipient outside the sales line', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const lead = await aLead(s)

    await expect(service.assign(admin, lead.id, s.bm.id)).rejects.toThrow(BadRequestException)
  })

  it('writes nothing when the lead is already theirs', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const lead = await aLead(s)

    await service.assign(admin, lead.id, s.saleRb.id)
    expect(await trace(lead.id)).toHaveLength(1)
  })

  /** The old owner does not merely lose the buttons — the lead leaves their
   *  book entirely, which is the honest result of scoping by ownership. */
  it('moves the lead out of the old owner’s reach', async () => {
    const s = await scene()
    const admin = await makeUser({ role: 'admin' })
    const taker = await makeUser({
      role: 'sale',
      segment: 'rb',
      managerId: s.leadRb.id,
      unitId: s.unit.id,
    })
    const lead = await aLead(s)
    await service.assign(admin, lead.id, taker.id)

    expect((await service.get(taker, lead.id)).actions.map((a) => a.action)).toEqual(['contact'])
    await expect(service.get(s.saleRb, lead.id)).rejects.toThrow(NotFoundException)
    /** Still visible to the team lead above both of them. */
    expect((await service.list(s.leadRb, {})).total).toBe(1)
  })
})

describe('the list', () => {
  it("shows a salesperson their own book and nobody else's", async () => {
    const s = await scene()
    await aLead(s)

    const sseCustomer = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    await service.create(s.saleSse, {
      customerId: sseCustomer.id,
      product: 'od',
      need: 'Working capital',
      value: 500_000_000,
    })

    const mine = await service.list(s.saleRb, {})
    expect(mine.total).toBe(1)
    expect(mine.rows[0].ownerId).toBe(s.saleRb.id)
  })

  /** A team lead's job is to notice the lead nobody has called. A scope that
   *  hid untouched leads from them would hide precisely the rows they exist
   *  to chase. */
  it("shows a team lead their own people's leads from the moment they exist", async () => {
    const s = await scene()
    await aLead(s)

    const seen = await service.list(s.leadRb, {})
    expect(seen.total).toBe(1)
    expect(seen.rows[0].stage).toBe('new')
  })

  it('shows the branch manager both segments', async () => {
    const s = await scene()
    await aLead(s)
    const sseCustomer = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    await service.create(s.saleSse, {
      customerId: sseCustomer.id,
      product: 'od',
      need: 'Working capital',
      value: 500_000_000,
    })

    const all = await service.list(s.bm, {})
    expect(all.total).toBe(2)
  })

  it('filters down to what nobody has called yet', async () => {
    const s = await scene()
    const called = await aLead(s)
    await aLead(s)
    await service.act(s.saleRb, called.id, 'contact')

    const untouched = await service.list(s.leadRb, { untouched: true })
    expect(untouched.total).toBe(1)
    expect(untouched.rows[0].id).not.toBe(called.id)
  })

  it('filters down to the signing queue, and empties it once signed', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    const queue = await service.list(s.leadRb, { awaitingConfirm: true })
    expect(queue.total).toBe(1)

    await service.act(s.leadRb, lead.id, 'confirm')
    expect((await service.list(s.leadRb, { awaitingConfirm: true })).total).toBe(0)
    expect((await service.list(s.leadRb, { confirmed: true })).total).toBe(1)
  })

  it('filters by outcome, product and source', async () => {
    const s = await scene()
    const won = await aLead(s)
    await walk(s, won.id, 'contact')
    await service.act(s.saleRb, won.id, 'win', { reason: 'Signed', products: SOLD })
    await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'card',
      need: 'Campaign list',
      value: 50_000_000,
      source: 'import',
    })

    expect((await service.list(s.saleRb, { outcome: 'won' })).total).toBe(1)
    expect((await service.list(s.saleRb, { outcome: 'open' })).total).toBe(1)
    expect((await service.list(s.saleRb, { product: 'card' })).total).toBe(1)
    expect((await service.list(s.saleRb, { source: 'import' })).total).toBe(1)
  })

  /** The buttons sit in the expanded row, and a list built to open several
   *  would otherwise be one request per row to ask about its own buttons. */
  it('carries each row’s buttons with it', async () => {
    const s = await scene()
    await aLead(s)

    const mine = await service.list(s.saleRb, {})
    expect(mine.rows[0].actions.map((a) => a.action)).toEqual(['contact'])

    const theirs = await service.list(s.leadRb, {})
    expect(theirs.rows[0].actions).toEqual([])
  })

  it('pages', async () => {
    const s = await scene()
    for (let i = 0; i < 3; i++) await aLead(s)

    const page = await service.list(s.saleRb, { page: 2, pageSize: 2 })
    expect(page.total).toBe(3)
    expect(page.rows).toHaveLength(1)
  })
})

describe('the history', () => {
  it('returns the whole trace in order, with who did each step', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact', 'advise')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Disbursed', products: SOLD })
    await service.act(s.leadRb, lead.id, 'confirm', { reason: 'Checked against the file' })

    const rows = await service.history(s.leadRb, lead.id)

    expect(rows.map((row) => row.kind)).toEqual([
      'created',
      'contacted',
      'advised',
      'won',
      'confirmed',
    ])
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5])
    expect(rows[3].actorName).toBe(s.saleRb.name)
    expect(rows[3].actorRole).toBe('sale')
    expect(rows[4].actorName).toBe(s.leadRb.name)
    expect(rows[4].actorRole).toBe('team_lead')
    expect(rows[4].reason).toBe('Checked against the file')
  })

  /** Written at the time rather than worked out on read, so the branch average
   *  for "handed out on Monday, first called on Friday" is a sum over one
   *  column instead of a window function over the whole log. */
  it('times every step but the first', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')

    const rows = await service.history(s.saleRb, lead.id)
    expect(rows[0].heldMs).toBeNull()
    expect(rows[1].heldMs).not.toBeNull()
    expect(rows[1].heldMs!).toBeGreaterThanOrEqual(0)
  })

  it('refuses a lead the caller cannot see', async () => {
    const s = await scene()
    const lead = await aLead(s)

    await expect(service.history(s.saleSse, lead.id)).rejects.toThrow(NotFoundException)
  })
})

describe('what a list row carries', () => {
  /** A UUID is not a customer name. Without this join the salesperson's own
   *  screen cannot draw a single row. */
  it('names the customer, the owner and the signer', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })
    await service.act(s.leadRb, lead.id, 'confirm')

    const [row] = (await service.list(s.leadRb, {})).rows
    expect(row.customerName).toBeTruthy()
    expect(row.customerCode).toBeTruthy()
    expect(row.ownerName).toBe(s.saleRb.name)
    expect(row.confirmedByName).toBe(s.leadRb.name)
  })

  it('leaves the signer empty until somebody signs', async () => {
    const s = await scene()
    await aLead(s)

    const [row] = (await service.list(s.saleRb, {})).rows
    expect(row.confirmedByName).toBeNull()
  })

  it('carries what a won deal sold, and nothing for one still open', async () => {
    const s = await scene()
    const won = await aLead(s)
    await walk(s, won.id, 'contact')
    await service.act(s.saleRb, won.id, 'win', { reason: 'Signed', products: SOLD })
    await aLead(s)

    const rows = (await service.list(s.saleRb, {})).rows
    const sold = rows.find((row) => row.outcome === 'won')!
    const open = rows.find((row) => row.outcome === 'open')!

    expect(sold.products.map((p) => p.product)).toEqual(['card', 'od'])
    expect(open.products).toEqual([])
  })

  /** The number the screen prints as "9 ngày chưa liên hệ". Sent rather than
   *  recomputed, so the row cannot disagree with the sort that put it there. */
  it('says when anything last happened to the lead', async () => {
    const s = await scene()
    const lead = await aLead(s)

    const before = (await service.list(s.saleRb, {})).rows[0]
    expect(before.lastTouchAt).toEqual(before.createdAt)

    await service.act(s.saleRb, lead.id, 'contact')
    const after = (await service.list(s.saleRb, {})).rows[0]
    expect(after.lastTouchAt).toEqual(after.contactedAt)
  })
})

describe('finding what needs chasing', () => {
  /** Backdating through the table rather than the service: these tests are
   *  about reading time, and waiting nine days is not an option. */
  async function age(id: string, days: number) {
    const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    await testDb
      .update(opportunities)
      .set({ createdAt: at, contactedAt: null, stage: 'new' })
      .where(eq(opportunities.id, id))
  }

  it('finds leads nothing has happened to for a given number of days', async () => {
    const s = await scene()
    const old = await aLead(s)
    await aLead(s)
    await age(old.id, 9)

    const stale = await service.list(s.leadRb, { staleDays: 7 })
    expect(stale.total).toBe(1)
    expect(stale.rows[0].id).toBe(old.id)
  })

  /** A lead that has been closed is not neglected, it is finished. Counting
   *  it would bury the ones that still need a call. */
  it('never calls a closed lead stale', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })
    await testDb
      .update(opportunities)
      .set({ createdAt: new Date(Date.now() - 90 * 86_400_000) })
      .where(eq(opportunities.id, lead.id))

    expect((await service.list(s.leadRb, { staleDays: 7 })).total).toBe(0)
  })

  it('puts the longest-neglected lead first when asked to', async () => {
    const s = await scene()
    const oldest = await aLead(s)
    const middle = await aLead(s)
    await aLead(s)
    await age(oldest.id, 30)
    await age(middle.id, 10)

    const chasing = await service.list(s.leadRb, { sort: 'stale' })
    expect(chasing.rows.map((row) => row.id).slice(0, 2)).toEqual([oldest.id, middle.id])
  })

  it('finds what is past its date and still open', async () => {
    const s = await scene()
    const late = await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'loan',
      need: 'Buy a home',
      value: 1_000_000_000,
      dueDate: '2020-01-01',
    })
    await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'card',
      need: 'Wants a card',
      value: 50_000_000,
      dueDate: '2999-01-01',
    })

    const overdue = await service.list(s.saleRb, { overdue: true })
    expect(overdue.total).toBe(1)
    expect(overdue.rows[0].id).toBe(late.id)
  })

  /** A deal closed after its date was late, not overdue. Leaving it in the
   *  list gives a team lead work that no longer exists. */
  it('drops a lead off the overdue list once it lands', async () => {
    const s = await scene()
    const late = await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'loan',
      need: 'Buy a home',
      value: 1_000_000_000,
      dueDate: '2020-01-01',
    })
    await walk(s, late.id, 'contact')
    await service.act(s.saleRb, late.id, 'win', { reason: 'Signed late', products: SOLD })

    expect((await service.list(s.saleRb, { overdue: true })).total).toBe(0)
  })

  it('orders by value, and by most recently touched', async () => {
    const s = await scene()
    await aLead(s, 1_000_000_000)
    const big = await aLead(s, 9_000_000_000)

    expect((await service.list(s.saleRb, { sort: 'value' })).rows[0].id).toBe(big.id)

    const first = (await service.list(s.saleRb, {})).rows[0]
    await service.act(s.saleRb, first.id, 'contact')
    expect((await service.list(s.saleRb, { sort: 'recent' })).rows[0].id).toBe(first.id)
  })

  /** Every filter is added on top of the scope, never in place of it. */
  it('keeps the scope when a chasing filter is applied', async () => {
    const s = await scene()
    const mine = await aLead(s)
    await age(mine.id, 30)

    const sseCustomer = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    const theirs = await service.create(s.saleSse, {
      customerId: sseCustomer.id,
      product: 'od',
      need: 'Working capital',
      value: 500_000_000,
    })
    await age(theirs.id, 30)

    const chasing = await service.list(s.leadRb, { staleDays: 7 })
    expect(chasing.rows.map((row) => row.id)).toEqual([mine.id])
  })
})

describe('who the signature is waiting on', () => {
  /** "Đang chờ xác nhận" is a status; "Đang chờ Huy xác nhận" is a person to
   *  go and ask. The screen does not hold the roster, so the name comes with
   *  the row. */
  it('names the owner’s team lead on a closed lead nobody has signed', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })

    const [row] = (await service.list(s.saleRb, {})).rows
    expect(row.pendingConfirmName).toBe(s.leadRb.name)
    expect(row.confirmedByName).toBeNull()

    const one = await service.get(s.saleRb, lead.id)
    expect(one.pendingConfirmName).toBe(s.leadRb.name)
  })

  /** The detail view must never say less than the row it was opened from. */
  it('says the same thing on one lead as it does in the list', async () => {
    const s = await scene()
    const lead = await aLead(s)
    await walk(s, lead.id, 'contact')
    await service.act(s.saleRb, lead.id, 'win', { reason: 'Signed', products: SOLD })
    await service.act(s.leadRb, lead.id, 'confirm')

    const [row] = (await service.list(s.saleRb, {})).rows
    const one = await service.get(s.saleRb, lead.id)

    for (const field of ['customerName', 'customerCode', 'ownerName', 'confirmedByName'] as const) {
      expect(one[field], field).toBe(row[field])
    }
  })

  /** Read off the lead in front of you, not off the customer. A customer with
   *  two leads on two people's books would otherwise borrow the wrong name. */
  it('reads the names off this lead, not off a sibling of it', async () => {
    const s = await scene()
    const mine = await aLead(s)

    const taker = await makeUser({
      role: 'sale',
      segment: 'rb',
      unitId: s.unit.id,
      managerId: s.leadSse.id,
      name: 'Người khác',
    })
    const theirs = await aLead(s)
    const admin = await makeUser({ role: 'admin', unitId: s.unit.id })
    await service.assign(admin, theirs.id, taker.id)

    expect((await service.get(s.leadRb, mine.id)).ownerName).toBe(s.saleRb.name)
    expect((await service.get(s.bm, theirs.id)).ownerName).toBe('Người khác')
  })
})

describe('finding a lead', () => {
  /** Somebody hunting for a lead remembers the customer's name long before
   *  they remember OPP-2026-0184. */
  it('searches the code, the need and the customer', async () => {
    const s = await scene()
    await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'loan',
      need: 'Mua căn hộ tại Gia Lâm',
      value: 2_000_000_000,
    })
    await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'card',
      need: 'Thẻ đi công tác',
      value: 50_000_000,
    })

    expect((await service.list(s.saleRb, { q: 'Gia Lâm' })).total).toBe(1)
    /** Accent-insensitive both ways, as on the customer search. */
    expect((await service.list(s.saleRb, { q: 'gia lam' })).total).toBe(1)
    expect((await service.list(s.saleRb, { q: 'OPP-' })).total).toBe(2)

    const customer = (await service.list(s.saleRb, {})).rows[0].customerName
    expect((await service.list(s.saleRb, { q: customer })).total).toBe(2)
  })

  it('filters by where the lead is stuck', async () => {
    const s = await scene()
    const stuck = await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'loan',
      need: 'Vay mua nhà',
      value: 2_000_000_000,
      blockerCode: 'rate',
    })
    await aLead(s)

    const onRate = await service.list(s.saleRb, { blockerCode: 'rate' })
    expect(onRate.total).toBe(1)
    expect(onRate.rows[0].id).toBe(stuck.id)
    expect((await service.list(s.saleRb, { blockerCode: 'documents' })).total).toBe(0)
  })

  /** A list sorted on the date alone puts last month's closed deals above
   *  this week's open ones, and the top of this list is meant to be what to
   *  do next rather than what has already been done. */
  it('keeps closed leads below the live ones whatever their dates', async () => {
    const s = await scene()
    const closed = await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'card',
      need: 'Đã xong',
      value: 50_000_000,
      dueDate: '2020-01-01',
    })
    await walk(s, closed.id, 'contact')
    await service.act(s.saleRb, closed.id, 'win', { reason: 'Signed', products: SOLD })

    const live = await service.create(s.saleRb, {
      customerId: s.customerId,
      product: 'loan',
      need: 'Đang chạy',
      value: 1_000_000_000,
      dueDate: '2999-01-01',
    })

    const rows = (await service.list(s.saleRb, {})).rows
    expect(rows[0].id).toBe(live.id)
    expect(rows[rows.length - 1].id).toBe(closed.id)
  })
})
