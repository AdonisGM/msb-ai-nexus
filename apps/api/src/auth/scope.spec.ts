import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, resetDb, testDb } from '../test/db'
import { makeBranch, makeCustomer, makeOpportunity, makeUser, type Branch } from '../test/factories'
import { customers, opportunities, type User } from '../db/schema'
import { customerScope, opportunityScope } from './scope'

/** The rule these tests defend: visibility runs vertically, never sideways.
 *  A salesperson sees their own book, a team lead sees their own people, a
 *  branch manager sees the unit — and nobody sees a peer's customers.
 *
 *  Every assertion goes through the same query shape the services use, so a
 *  scope that compiles but selects the wrong rows fails here. */

async function visibleCustomers(user: User) {
  const rows = await testDb
    .select({ id: customers.id })
    .from(customers)
    .where(customerScope(testDb, user))
  return rows.map((row) => row.id).sort()
}

async function visibleOpportunities(user: User) {
  const rows = await testDb
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(opportunityScope(testDb, user))
  return rows.map((row) => row.id).sort()
}

beforeEach(resetDb)
afterAll(closeDb)

describe('customer scope', () => {
  type Fixture = Branch & { sseCustomer: string; rbCustomer: string }

  async function branchWithCustomers(): Promise<Fixture> {
    const branch = await makeBranch()
    const sseCustomer = await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })
    const rbCustomer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    return { ...branch, sseCustomer: sseCustomer.id, rbCustomer: rbCustomer.id }
  }

  it('gives a salesperson only their own book', async () => {
    const f = await branchWithCustomers()
    expect(await visibleCustomers(f.saleSse)).toEqual([f.sseCustomer])
  })

  it("hides a peer's customers from a salesperson", async () => {
    const f = await branchWithCustomers()
    expect(await visibleCustomers(f.saleRb)).not.toContain(f.sseCustomer)
  })

  it('gives a team lead their own people', async () => {
    const f = await branchWithCustomers()
    expect(await visibleCustomers(f.leadSse)).toEqual([f.sseCustomer])
  })

  it("hides the other team's customers from a team lead", async () => {
    const f = await branchWithCustomers()
    expect(await visibleCustomers(f.leadSse)).not.toContain(f.rbCustomer)
    expect(await visibleCustomers(f.leadRb)).not.toContain(f.sseCustomer)
  })

  it("includes a team lead's own accounts alongside their people's", async () => {
    const f = await branchWithCustomers()
    const ownAccount = await makeCustomer({ ownerId: f.leadSse.id, segment: 'sse' })

    expect(await visibleCustomers(f.leadSse)).toEqual([f.sseCustomer, ownAccount.id].sort())
  })

  it('gives a branch manager the whole unit', async () => {
    const f = await branchWithCustomers()
    expect(await visibleCustomers(f.bm)).toEqual([f.sseCustomer, f.rbCustomer].sort())
  })

  it('stops at the unit boundary', async () => {
    const here = await branchWithCustomers()
    const elsewhere = await makeBranch()
    const theirCustomer = await makeCustomer({ ownerId: elsewhere.saleRb.id })

    expect(await visibleCustomers(here.bm)).not.toContain(theirCustomer.id)
    expect(await visibleCustomers(elsewhere.bm)).not.toContain(here.rbCustomer)
  })

  it('gives an admin everything, across units', async () => {
    const here = await branchWithCustomers()
    const elsewhere = await makeBranch()
    const theirCustomer = await makeCustomer({ ownerId: elsewhere.saleRb.id })
    const admin = await makeUser({ role: 'admin', unitId: here.unit.id })

    expect(await visibleCustomers(admin)).toEqual(
      [here.sseCustomer, here.rbCustomer, theirCustomer.id].sort(),
    )
  })

  it('returns nothing rather than erroring when a salesperson has no book', async () => {
    const branch = await makeBranch()
    expect(await visibleCustomers(branch.saleSse)).toEqual([])
  })
})
describe('opportunity scope', () => {
  /** One book, three leads at three points of the funnel. There is no status
   *  gate any more, so what these assert is purely who owns what. */
  async function branchWithLeads() {
    const branch = await makeBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })

    const fresh = await makeOpportunity({
      customerId: customer.id,
      ownerId: branch.saleRb.id,
    })
    const working = await makeOpportunity({
      customerId: customer.id,
      ownerId: branch.saleRb.id,
      stage: 'advised',
    })
    const landed = await makeOpportunity({
      customerId: customer.id,
      ownerId: branch.saleRb.id,
      stage: 'advised',
      outcome: 'won',
    })

    return { ...branch, fresh: fresh.id, working: working.id, landed: landed.id }
  }

  it('gives a salesperson their own book at every point of the funnel', async () => {
    const f = await branchWithLeads()
    expect(await visibleOpportunities(f.saleRb)).toEqual(
      [f.fresh, f.working, f.landed].sort(),
    )
  })

  /** This is the rule that replaced the old draft gate, and it is the opposite
   *  of it. A team lead's job is to notice the lead nobody has called yet; a
   *  scope that hid untouched leads from them would hide precisely the rows
   *  they exist to chase. */
  it('shows a team lead an untouched lead from the moment it exists', async () => {
    const f = await branchWithLeads()
    expect(await visibleOpportunities(f.leadRb)).toEqual(
      [f.fresh, f.working, f.landed].sort(),
    )
  })

  it("hides the other team's leads from a team lead", async () => {
    const f = await branchWithLeads()
    expect(await visibleOpportunities(f.leadSse)).toEqual([])
  })

  /** The branch manager reports on the whole unit, so they count everything in
   *  it — including what nobody has started. A funnel missing its own top is
   *  not a funnel. */
  it('gives the branch manager the whole unit, untouched leads included', async () => {
    const f = await branchWithLeads()
    expect(await visibleOpportunities(f.bm)).toEqual([f.fresh, f.working, f.landed].sort())
  })

  it('stops at the unit boundary for a branch manager', async () => {
    const here = await branchWithLeads()
    const elsewhere = await makeBranch()
    const theirCustomer = await makeCustomer({ ownerId: elsewhere.saleRb.id })
    const theirLead = await makeOpportunity({
      customerId: theirCustomer.id,
      ownerId: elsewhere.saleRb.id,
    })

    expect(await visibleOpportunities(here.bm)).not.toContain(theirLead.id)
  })

  it('gives an admin every lead in every branch', async () => {
    const f = await branchWithLeads()
    const admin = await makeUser({ role: 'admin', unitId: f.unit.id })

    expect(await visibleOpportunities(admin)).toEqual([f.fresh, f.working, f.landed].sort())
  })

  /** Scoping has to survive being combined with the filters a screen adds,
   *  which is where a condition built as a bare `or` would silently widen. */
  it('still holds when a screen adds its own filter', async () => {
    const f = await branchWithLeads()

    const rows = await testDb
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(opportunityScope(testDb, f.leadRb), eq(opportunities.outcome, 'won')))

    expect(rows.map((row) => row.id)).toEqual([f.landed])
  })

  it("does not let a screen filter widen another team lead's view", async () => {
    const f = await branchWithLeads()

    const rows = await testDb
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(opportunityScope(testDb, f.leadSse), eq(opportunities.outcome, 'won')))

    expect(rows).toEqual([])
  })
})