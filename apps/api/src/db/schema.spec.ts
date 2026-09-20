import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, resetDb, testDb } from '../test/db'
import {
  makeAuditEvent,
  makeBranch,
  makeCustomer,
  makeOpportunity,
  makeOpportunityProduct,
  makeSignal,
  makeTarget,
  makeUnit,
  makeUser,
} from '../test/factories'
import {
  auditEvents,
  customers,
  opportunities,
  opportunityProducts,
  signals,
  targets,
  users,
} from './schema'

/** These rules live in the database rather than in a service on purpose: they
 *  are the ones that must hold even when a future controller forgets them, so
 *  they are worth asserting directly. Each test names the constraint it
 *  expects, so a rename that silently drops a rule fails here rather than in
 *  production.
 *
 *  Drizzle wraps the driver error, so the constraint name may sit on the error
 *  itself or on its cause. Reading both keeps the assertion about the rule
 *  rather than about which layer happened to raise it. */
function constraintOf(error: unknown): string | undefined {
  const seen = error as { constraint_name?: string; cause?: { constraint_name?: string } }
  return seen?.constraint_name ?? seen?.cause?.constraint_name
}

async function expectViolation(work: Promise<unknown>, constraint: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error, `expected ${constraint} to be violated, but the write succeeded`).not.toBeNull()
  expect(constraintOf(error)).toBe(constraint)
}

beforeEach(resetDb)
afterAll(closeDb)

describe('users', () => {
  it('accepts the five operating accounts wired into one tree', async () => {
    const branch = await makeBranch()

    expect(branch.bm.managerId).toBeNull()
    expect(branch.leadSse.managerId).toBe(branch.bm.id)
    expect(branch.saleSse.managerId).toBe(branch.leadSse.id)
    expect(branch.saleRb.managerId).toBe(branch.leadRb.id)
  })

  it('requires a segment for salespeople and team leads', async () => {
    const unit = await makeUnit()
    const bm = await makeUser({ unitId: unit.id, role: 'bm' })

    await expectViolation(
      testDb.insert(users).values({
        id: 'u_no_segment',
        code: 'U-NO-SEGMENT',
        employeeCode: 'U-NO-SEGMENT',
        name: 'No segment',
        passwordHash: 'x',
        role: 'sale',
        title: 'Tester',
        unitId: unit.id,
        managerId: bm.id,
        segment: null,
      }),
      'users_segment_by_role',
    )
  })

  it('lets a branch manager cover the whole unit with no segment', async () => {
    const bm = await makeUser({ role: 'bm' })
    expect(bm.segment).toBeNull()
  })

  it('requires everyone but the branch manager to report to someone', async () => {
    const unit = await makeUnit()

    await expectViolation(
      testDb.insert(users).values({
        id: 'u_orphan',
        code: 'U-ORPHAN',
        employeeCode: 'U-ORPHAN',
        name: 'Orphan',
        passwordHash: 'x',
        role: 'team_lead',
        title: 'Tester',
        unitId: unit.id,
        segment: 'rb',
        managerId: null,
      }),
      'users_manager_by_role',
    )
  })

  it('keeps the admin out of the sales tree entirely', async () => {
    const unit = await makeUnit()
    const bm = await makeUser({ unitId: unit.id, role: 'bm' })

    await expectViolation(
      testDb.insert(users).values({
        id: 'u_admin_segment',
        code: 'U-ADMIN-SEGMENT',
        employeeCode: 'U-ADMIN-SEGMENT',
        name: 'Admin with a segment',
        passwordHash: 'x',
        role: 'admin',
        title: 'Admin',
        unitId: unit.id,
        segment: 'rb',
      }),
      'users_admin_outside_tree',
    )

    await expectViolation(
      testDb.insert(users).values({
        id: 'u_admin_manager',
        code: 'U-ADMIN-MANAGER',
        employeeCode: 'U-ADMIN-MANAGER',
        name: 'Admin with a manager',
        passwordHash: 'x',
        role: 'admin',
        title: 'Admin',
        unitId: unit.id,
        managerId: bm.id,
      }),
      'users_admin_outside_tree',
    )
  })

  it('rejects a role outside the closed set', async () => {
    const unit = await makeUnit()
    const bm = await makeUser({ unitId: unit.id, role: 'bm' })

    await expectViolation(
      testDb.insert(users).values({
        id: 'u_superuser',
        code: 'U-SUPERUSER',
        employeeCode: 'U-SUPERUSER',
        name: 'Superuser',
        passwordHash: 'x',
        role: 'superuser',
        title: 'Tester',
        unitId: unit.id,
        segment: 'rb',
        managerId: bm.id,
      }),
      'users_role',
    )
  })
})

describe('signals', () => {
  it('records an observation against a customer', async () => {
    const owner = await makeUser()
    const customer = await makeCustomer({ ownerId: owner.id })
    const signal = await makeSignal({
      customerId: customer.id,
      type: 'competition',
      content: 'Comparing rates with another bank',
      source: 'sale',
      authorId: owner.id,
    })

    expect(signal.type).toBe('competition')
  })

  it('requires an author when a person wrote it', async () => {
    const owner = await makeUser()
    const customer = await makeCustomer({ ownerId: owner.id })

    await expectViolation(
      testDb.insert(signals).values({
        id: 'sig_anon',
        customerId: customer.id,
        type: 'need',
        content: 'Anonymous',
        source: 'sale',
        authorId: null,
      }),
      'signals_author_by_source',
    )
  })

  it('allows the system and the model to write anonymously', async () => {
    const owner = await makeUser()
    const customer = await makeCustomer({ ownerId: owner.id })

    const fromSystem = await makeSignal({ customerId: customer.id, source: 'system' })
    const fromModel = await makeSignal({ customerId: customer.id, source: 'ai' })

    expect(fromSystem.authorId).toBeNull()
    expect(fromModel.authorId).toBeNull()
  })

  it('goes away with its customer', async () => {
    const owner = await makeUser()
    const customer = await makeCustomer({ ownerId: owner.id })
    await makeSignal({ customerId: customer.id })

    await testDb.delete(customers)
    expect(await testDb.select().from(signals)).toHaveLength(0)
  })
})

describe('opportunities', () => {
  async function aDeal() {
    const owner = await makeUser()
    const customer = await makeCustomer({ ownerId: owner.id })
    return { owner, customer, unitId: owner.unitId }
  }

  it('starts a lead untouched at the top of the funnel', async () => {
    const { owner, customer } = await aDeal()
    const deal = await makeOpportunity({ customerId: customer.id, ownerId: owner.id })

    expect(deal.stage).toBe('new')
    expect(deal.outcome).toBe('open')
    expect(deal.contactedAt).toBeNull()
    expect(deal.advisedAt).toBeNull()
    expect(deal.closedAt).toBeNull()
    expect(deal.confirmedAt).toBeNull()
    expect(deal.source).toBe('manual')
    expect(deal.createdVia).toBe('manual')
  })

  it("keeps confirmed data and the model's guesses apart", async () => {
    const { owner, customer } = await aDeal()
    const deal = await makeOpportunity({
      customerId: customer.id,
      ownerId: owner.id,
      confirmedData: { repaymentSource: 'salary' },
      aiHypothesis: { blocker: 'rate' },
    })

    expect(deal.confirmedData).toEqual({ repaymentSource: 'salary' })
    expect(deal.aiHypothesis).toEqual({ blocker: 'rate' })
  })

  it('rejects a deal worth nothing', async () => {
    const { owner, customer, unitId } = await aDeal()

    await expectViolation(
      testDb.insert(opportunities).values({
        id: 'opp_zero',
        code: 'OPP-ZERO',
        customerId: customer.id,
        ownerId: owner.id,
        segment: 'rb',
        unitId,
        product: 'loan',
        need: 'Buy a home',
        value: 0,
      }),
      'opportunities_value',
    )
  })

  it('only sells a product the branch report has a column for', async () => {
    const { owner, customer } = await aDeal()

    await expectViolation(
      makeOpportunity({ customerId: customer.id, ownerId: owner.id, product: 'the_tin_dung' }),
      'opportunities_product',
    )
  })

  it('will not close a deal without saying why', async () => {
    const { owner, customer } = await aDeal()

    /** The factory fills a reason in for every closed deal, so this one asks
     *  for it back out — otherwise the test would pass on the factory's
     *  courtesy rather than on the constraint. */
    await expectViolation(
      makeOpportunity({
        customerId: customer.id,
        ownerId: owner.id,
        outcome: 'lost',
        outcomeReason: null,
      }),
      'opportunities_outcome_reason',
    )

    const won = await makeOpportunity({
      customerId: customer.id,
      ownerId: owner.id,
      outcome: 'won',
      outcomeReason: 'Rate concession approved',
    })
    expect(won.outcome).toBe('won')
  })

  it('only accepts a blocker from the closed set, so identical ones group', async () => {
    const { owner, customer } = await aDeal()

    await expectViolation(
      makeOpportunity({ customerId: customer.id, ownerId: owner.id, blockerCode: 'lai_suat' }),
      'opportunities_blocker_code',
    )

    const stuck = await makeOpportunity({
      customerId: customer.id,
      ownerId: owner.id,
      blockerCode: 'rate',
      blockerNote: 'Wants 0.3% off',
    })
    expect(stuck.blockerCode).toBe('rate')
  })

  it('rejects a stage outside the three-step funnel', async () => {
    const { owner, customer } = await aDeal()

    await expectViolation(
      makeOpportunity({ customerId: customer.id, ownerId: owner.id, stage: 'negotiation' }),
      'opportunities_stage',
    )
  })

  /** The funnel is counted from the marks, not from the stage column, so a row
   *  where the two disagree would be counted by one screen and missed by
   *  another with nobody able to say which figure was right. */
  it('keeps the stage and its funnel marks locked together', async () => {
    const { owner, customer } = await aDeal()

    await expectViolation(
      makeOpportunity({
        customerId: customer.id,
        ownerId: owner.id,
        stage: 'contacted',
        contactedAt: null,
      }),
      'opportunities_stage_marks',
    )

    await expectViolation(
      makeOpportunity({
        customerId: customer.id,
        ownerId: owner.id,
        stage: 'advised',
        advisedAt: null,
      }),
      'opportunities_stage_marks',
    )

    await expectViolation(
      makeOpportunity({
        customerId: customer.id,
        ownerId: owner.id,
        stage: 'new',
        contactedAt: new Date(),
      }),
      'opportunities_stage_marks',
    )
  })

  it('walks a lead through the funnel, marking each step', async () => {
    const { owner, customer } = await aDeal()

    const fresh = await makeOpportunity({ customerId: customer.id, ownerId: owner.id })
    expect(fresh.contactedAt).toBeNull()

    const called = await makeOpportunity({
      customerId: customer.id,
      ownerId: owner.id,
      stage: 'contacted',
    })
    expect(called.contactedAt).not.toBeNull()
    expect(called.advisedAt).toBeNull()

    const advised = await makeOpportunity({
      customerId: customer.id,
      ownerId: owner.id,
      stage: 'advised',
    })
    expect(advised.contactedAt).not.toBeNull()
    expect(advised.advisedAt).not.toBeNull()
  })

  /** A deal can land straight off a first call — the funnel measures how far
   *  the conversation got, not a sequence the outcome has to pass through. */
  it('lets a lead be won without ever reaching the advised step', async () => {
    const { owner, customer } = await aDeal()

    const won = await makeOpportunity({
      customerId: customer.id,
      ownerId: owner.id,
      stage: 'contacted',
      outcome: 'won',
      outcomeReason: 'Signed on the first call',
    })

    expect(won.stage).toBe('contacted')
    expect(won.advisedAt).toBeNull()
    expect(won.closedAt).not.toBeNull()
  })

  it('keeps the outcome and the closing time locked together', async () => {
    const { owner, customer } = await aDeal()

    await expectViolation(
      makeOpportunity({
        customerId: customer.id,
        ownerId: owner.id,
        outcome: 'won',
        outcomeReason: 'Signed',
        closedAt: null,
      }),
      'opportunities_closed_mark',
    )

    await expectViolation(
      makeOpportunity({ customerId: customer.id, ownerId: owner.id, closedAt: new Date() }),
      'opportunities_closed_mark',
    )
  })

  describe("the team lead's reconciliation mark", () => {
    it('records who checked the paperwork and when', async () => {
      const { owner, customer } = await aDeal()
      const lead = await makeUser({ role: 'team_lead' })

      const confirmed = await makeOpportunity({
        customerId: customer.id,
        ownerId: owner.id,
        outcome: 'won',
        outcomeReason: 'Card issued',
        confirmedById: lead.id,
        confirmedAt: new Date(),
        confirmNote: 'Matches the signed application',
      })

      expect(confirmed.confirmedById).toBe(lead.id)
    })

    it('refuses a signature with nobody behind it, or a signer with no date', async () => {
      const { owner, customer } = await aDeal()
      const lead = await makeUser({ role: 'team_lead' })

      await expectViolation(
        makeOpportunity({
          customerId: customer.id,
          ownerId: owner.id,
          outcome: 'won',
          outcomeReason: 'Card issued',
          confirmedAt: new Date(),
        }),
        'opportunities_confirm_pair',
      )

      await expectViolation(
        makeOpportunity({
          customerId: customer.id,
          ownerId: owner.id,
          outcome: 'won',
          outcomeReason: 'Card issued',
          confirmedById: lead.id,
        }),
        'opportunities_confirm_pair',
      )
    })

    /** There is no paperwork to check against until the deal has landed one
     *  way or the other. */
    it('refuses to reconcile a lead that is still open', async () => {
      const { owner, customer } = await aDeal()
      const lead = await makeUser({ role: 'team_lead' })

      await expectViolation(
        makeOpportunity({
          customerId: customer.id,
          ownerId: owner.id,
          confirmedById: lead.id,
          confirmedAt: new Date(),
        }),
        'opportunities_confirm_closed',
      )
    })
  })
})

describe('opportunity products', () => {
  async function aWonDeal() {
    const owner = await makeUser()
    const customer = await makeCustomer({ ownerId: owner.id })
    const deal = await makeOpportunity({
      customerId: customer.id,
      ownerId: owner.id,
      stage: 'advised',
      outcome: 'won',
      outcomeReason: 'Signed',
    })
    return { owner, deal }
  }

  /** The branch's own figures show more products than successful deals — a
   *  card sold alongside an overdraft is one deal and two product rows — which
   *  is the reason this is a table and not a column. */
  it('lets one deal carry more than one product', async () => {
    const { deal } = await aWonDeal()

    await makeOpportunityProduct({ opportunityId: deal.id, product: 'card', amount: 0 })
    await makeOpportunityProduct({
      opportunityId: deal.id,
      product: 'od',
      amount: 500_000_000,
    })

    const rows = await testDb.select().from(opportunityProducts)
    expect(rows).toHaveLength(2)
    expect(rows.reduce((total, row) => total + row.amount, 0)).toBe(500_000_000)
  })

  it('refuses the same product twice, which would double the branch count', async () => {
    const { deal } = await aWonDeal()

    await makeOpportunityProduct({ opportunityId: deal.id, product: 'card' })
    await expectViolation(
      makeOpportunityProduct({ opportunityId: deal.id, product: 'card' }),
      'opportunity_products_key',
    )
  })

  it('accepts a product sold for nothing but not for less', async () => {
    const { deal } = await aWonDeal()

    const free = await makeOpportunityProduct({
      opportunityId: deal.id,
      product: 'casa',
      amount: 0,
    })
    expect(free.amount).toBe(0)

    await expectViolation(
      makeOpportunityProduct({ opportunityId: deal.id, product: 'card', amount: -1 }),
      'opportunity_products_amount',
    )
  })

  it('goes away with its deal', async () => {
    const { deal } = await aWonDeal()
    await makeOpportunityProduct({ opportunityId: deal.id })

    await testDb.delete(opportunities)
    expect(await testDb.select().from(opportunityProducts)).toHaveLength(0)
  })
})

describe('audit events', () => {
  async function aDeal() {
    const owner = await makeUser()
    const customer = await makeCustomer({ ownerId: owner.id })
    const deal = await makeOpportunity({ customerId: customer.id, ownerId: owner.id })
    return { owner, deal }
  }

  it('starts a trace with nothing to measure from', async () => {
    const { owner, deal } = await aDeal()

    const first = await makeAuditEvent({
      opportunityId: deal.id,
      actorId: owner.id,
      kind: 'created',
    })

    expect(first.seq).toBe(1)
    expect(first.heldMs).toBeNull()
  })

  it('refuses a later event with no time recorded, which would bend every duration', async () => {
    const { owner, deal } = await aDeal()

    await expectViolation(
      testDb.insert(auditEvents).values({
        id: 'aud_untimed',
        opportunityId: deal.id,
        seq: 2,
        actorId: owner.id,
        kind: 'contacted',
        heldMs: null,
      }),
      'audit_events_first_event',
    )
  })

  it('refuses a first event that claims to have been waiting', async () => {
    const { owner, deal } = await aDeal()

    await expectViolation(
      testDb.insert(auditEvents).values({
        id: 'aud_early',
        opportunityId: deal.id,
        seq: 1,
        actorId: owner.id,
        kind: 'created',
        heldMs: 5_000,
      }),
      'audit_events_first_event',
    )
  })

  it('rejects an event kind nobody reports on', async () => {
    const { owner, deal } = await aDeal()

    await expectViolation(
      makeAuditEvent({ opportunityId: deal.id, actorId: owner.id, kind: 'escalated' }),
      'audit_events_kind',
    )
  })

  it('will not let two events claim the same position in a trace', async () => {
    const { owner, deal } = await aDeal()

    await makeAuditEvent({ opportunityId: deal.id, actorId: owner.id, seq: 1 })

    await expectViolation(
      makeAuditEvent({ opportunityId: deal.id, actorId: owner.id, seq: 1 }),
      'audit_events_trace',
    )
  })

  /** A reassignment is a field change like any other. Keeping it in `changes`
   *  rather than in a column of its own is what let the recipient column go
   *  when the approval chain did. */
  it('records a handover as a change of owner', async () => {
    const { owner, deal } = await aDeal()
    const admin = await makeUser({ role: 'admin' })
    const taker = await makeUser({ role: 'sale' })

    const handover = await makeAuditEvent({
      opportunityId: deal.id,
      actorId: admin.id,
      kind: 'assigned',
      changes: { ownerId: [owner.id, taker.id] },
    })

    expect(handover.changes).toEqual({ ownerId: [owner.id, taker.id] })
  })

  /** The whole point of storing `heldMs` at write time: the branch average for
   *  "handed out on Monday, first called on Friday" is a sum over one column,
   *  not a window function over the log. */
  it('answers how long each step took in one pass', async () => {
    const { owner, deal } = await aDeal()

    const trace: Array<[number, string, number | null]> = [
      [1, 'created', null],
      [2, 'assigned', 30_000],
      [3, 'contacted', 172_800_000],
      [4, 'advised', 86_400_000],
      [5, 'won', 3_600_000],
      [6, 'confirmed', 7_200_000],
    ]

    for (const [seq, kind, heldMs] of trace) {
      await makeAuditEvent({
        opportunityId: deal.id,
        actorId: owner.id,
        seq,
        kind: kind as never,
        heldMs,
      })
    }

    const rows = await testDb.select().from(auditEvents)
    expect(rows).toHaveLength(6)

    const firstCall = rows.find((row) => row.kind === 'contacted')
    expect(firstCall?.heldMs).toBe(172_800_000)

    const timed = rows.filter((row) => row.heldMs !== null)
    expect(timed).toHaveLength(5)
    expect(timed.reduce((total, row) => total + (row.heldMs ?? 0), 0)).toBe(270_030_000)
  })

  it('goes away with its deal', async () => {
    const { owner, deal } = await aDeal()
    await makeAuditEvent({ opportunityId: deal.id, actorId: owner.id })

    await testDb.delete(opportunities)
    expect(await testDb.select().from(auditEvents)).toHaveLength(0)
  })
})

describe('targets', () => {
  /** The branch reports against a conversion rate, so that is the default
   *  metric. Basis points keep the gap arithmetic in integers: 600 is 6%. */
  it('stores a unit number and a personal number side by side', async () => {
    const branch = await makeBranch()

    const unitTarget = await makeTarget({ unitId: branch.unit.id, amount: 600 })
    const personal = await makeTarget({
      scope: 'user',
      ownerId: branch.saleRb.id,
      unitId: branch.unit.id,
      amount: 800,
    })

    expect(unitTarget.ownerId).toBeNull()
    expect(unitTarget.metric).toBe('cr_rate')
    expect(personal.ownerId).toBe(branch.saleRb.id)
  })

  it('carries a money target beside a rate target without either replacing the other', async () => {
    const branch = await makeBranch()

    await makeTarget({ unitId: branch.unit.id, metric: 'cr_rate', amount: 600 })
    await makeTarget({ unitId: branch.unit.id, metric: 'value', amount: 10_000_000_000 })
    await makeTarget({ unitId: branch.unit.id, metric: 'deals', amount: 284 })

    expect(await testDb.select().from(targets)).toHaveLength(3)
  })

  it('rejects a metric nothing reports on', async () => {
    const branch = await makeBranch()

    await expectViolation(
      makeTarget({ unitId: branch.unit.id, metric: 'headcount', amount: 5 }),
      'targets_metric',
    )
  })

  /** A rate above 100% is a typo, and one that reaches a report makes every
   *  gap on it negative. */
  it('refuses a conversion target above a hundred percent', async () => {
    const branch = await makeBranch()

    await expectViolation(
      makeTarget({ unitId: branch.unit.id, metric: 'cr_rate', amount: 10_001 }),
      'targets_cr_rate_range',
    )

    const exactly = await makeTarget({
      unitId: branch.unit.id,
      metric: 'cr_rate',
      amount: 10_000,
    })
    expect(exactly.amount).toBe(10_000)
  })

  it('refuses a unit target that also names a person, which would double count', async () => {
    const branch = await makeBranch()

    await expectViolation(
      makeTarget({ unitId: branch.unit.id, scope: 'unit', ownerId: branch.saleRb.id }),
      'targets_owner_by_scope',
    )
  })

  it('refuses a personal target with nobody attached', async () => {
    const branch = await makeBranch()

    await expectViolation(
      makeTarget({ unitId: branch.unit.id, scope: 'user' }),
      'targets_owner_by_scope',
    )
  })

  /** The reason the unique index uses coalesce: Postgres treats NULLs as
   *  distinct, so a plain index would let two unit targets for the same
   *  quarter through, and the gap would then depend on which row a query read
   *  first. */
  it('allows only one unit target per metric per period', async () => {
    const branch = await makeBranch()

    await makeTarget({ unitId: branch.unit.id, amount: 600 })

    await expectViolation(
      makeTarget({ unitId: branch.unit.id, amount: 700 }),
      'targets_key',
    )
  })

  it('still allows one target per segment in the same unit and period', async () => {
    const branch = await makeBranch()

    for (const segment of ['sse', 'rb'] as const) {
      await makeTarget({ unitId: branch.unit.id, segment, amount: 600 })
    }

    expect(await testDb.select().from(targets)).toHaveLength(2)
  })

  it('rejects a target of zero', async () => {
    const branch = await makeBranch()

    await expectViolation(makeTarget({ unitId: branch.unit.id, amount: 0 }), 'targets_amount')
  })
})
