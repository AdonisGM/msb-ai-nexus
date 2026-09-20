import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { AuthService } from '../auth/auth.service'
import { SessionService } from '../auth/session.service'
import { sessions, users } from '../db/schema'
import { closeDb, resetDb, testDb } from '../test/db'
import { TEST_PASSWORD, makeBranch, makeCustomer, makeUnit, makeUser } from '../test/factories'
import { UsersService, type TreeNode } from './users.service'

const sessionService = new SessionService(testDb, {
  origins: ['http://localhost:5273'],
  cookieName: 'nexus_session',
  cookieSecure: false,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  idleTimeoutMs: 0,
})
const service = new UsersService(testDb, sessionService)
const auth = new AuthService(testDb)

beforeEach(resetDb)
afterAll(closeDb)

/** Flattens to `Name > Name > Name` paths, which reads better in a failure
 *  than a nested object printed across forty lines. */
function paths(nodes: TreeNode[], prefix = ''): string[] {
  return nodes.flatMap((node) => {
    const here = prefix ? `${prefix} > ${node.name}` : node.name
    return node.reports.length === 0 ? [here] : paths(node.reports, here)
  })
}

function find(nodes: TreeNode[], name: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node
    const deeper = find(node.reports, name)
    if (deeper) return deeper
  }
  return undefined
}

describe('the branch tree', () => {
  it('puts the branch manager at the root, team leads under, salespeople under those', async () => {
    const branch = await makeBranch()
    const tree = await service.tree(branch.saleRb)

    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe(branch.bm.name)
    expect(tree[0].role).toBe('bm')

    expect(paths(tree).sort()).toEqual(
      [
        `${branch.bm.name} > ${branch.leadRb.name} > ${branch.saleRb.name}`,
        `${branch.bm.name} > ${branch.leadSse.name} > ${branch.saleSse.name}`,
      ].sort(),
    )
  })

  /** The whole reason this exists. A salesperson could previously see only
   *  `managerId`, an opaque id, so no screen could say who signs off their
   *  wins or who is chasing them. */
  it('lets a salesperson find their own team lead by name', async () => {
    const branch = await makeBranch()
    const tree = await service.tree(branch.saleRb)

    const lead = find(tree, branch.leadRb.name)
    expect(lead).toBeDefined()
    expect(lead!.reports.map((node) => node.id)).toContain(branch.saleRb.id)
  })

  /** An org chart is not a permission. Everyone in a branch sees the same
   *  chart; who may read whose leads is a different rule and lives in
   *  `opportunityScope`, which this must never be confused with. */
  it('shows every role the same chart', async () => {
    const branch = await makeBranch()

    const asSale = paths(await service.tree(branch.saleRb))
    const asLead = paths(await service.tree(branch.leadSse))
    const asBm = paths(await service.tree(branch.bm))

    expect(asSale).toEqual(asBm)
    expect(asLead).toEqual(asBm)
  })

  /** A technical account that sits outside the sales line by constraint.
   *  Putting it in the chart would make the branch look one head larger and
   *  skew every per-person average taken off it. */
  it('leaves the admin out entirely', async () => {
    const branch = await makeBranch()
    const admin = await makeUser({ role: 'admin', unitId: branch.unit.id, name: 'Quản trị' })

    const tree = await service.tree(admin)
    expect(find(tree, 'Quản trị')).toBeUndefined()
    expect(paths(tree)).toHaveLength(2)
  })

  it('gives the admin their own branch tree, to place a lead with', async () => {
    const branch = await makeBranch()
    const admin = await makeUser({ role: 'admin', unitId: branch.unit.id })

    const tree = await service.tree(admin)
    expect(tree[0].name).toBe(branch.bm.name)
  })

  it('stops at the branch boundary', async () => {
    const here = await makeBranch()
    const elsewhere = await makeBranch()

    const tree = await service.tree(here.saleRb)
    expect(find(tree, elsewhere.bm.name)).toBeUndefined()
    expect(find(tree, elsewhere.saleRb.name)).toBeUndefined()
  })

  it('carries the staff number, which is what an upload names people by', async () => {
    const branch = await makeBranch()
    const tree = await service.tree(branch.saleRb)

    expect(find(tree, branch.saleRb.name)?.employeeCode).toBe(branch.saleRb.employeeCode)
  })

  it('keeps someone who has left the branch visible but marked inactive', async () => {
    const branch = await makeBranch()
    const gone = await makeUser({
      role: 'sale',
      segment: 'rb',
      unitId: branch.unit.id,
      managerId: branch.leadRb.id,
      active: false,
      name: 'Đã nghỉ',
    })

    const tree = await service.tree(branch.saleRb)
    expect(find(tree, gone.name)?.active).toBe(false)
  })

  /** A gap in the tree is a data problem worth seeing. Silently dropping the
   *  orphan would leave a screen that says nothing is wrong while somebody is
   *  missing from every report their manager runs. */
  it('surfaces a team lead whose manager sits outside the branch', async () => {
    const unit = await makeUnit()
    const elsewhere = await makeBranch()
    const orphan = await makeUser({
      role: 'team_lead',
      segment: 'rb',
      unitId: unit.id,
      managerId: elsewhere.bm.id,
      name: 'Nhóm lạc',
    })

    const tree = await service.tree(orphan)
    expect(tree.map((node) => node.name)).toEqual(['Nhóm lạc'])
  })

  it('returns nothing rather than erroring for a branch with no sales line', async () => {
    const unit = await makeUnit()
    const admin = await makeUser({ role: 'admin', unitId: unit.id })

    expect(await service.tree(admin)).toEqual([])
  })
})

/** An admin and the branch they administer. Everything below writes through
 *  the service rather than the factory, because what is being tested is the
 *  handful of rules the database cannot state on its own. */
async function withAdmin() {
  const branch = await makeBranch()
  const admin = await makeUser({ role: 'admin', unitId: branch.unit.id })
  return { ...branch, admin }
}

function newSale(over: Record<string, unknown> = {}) {
  return {
    code: 'SALE-RB-09',
    employeeCode: 'NV0099',
    name: 'Người mới',
    role: 'sale',
    title: 'Chuyên viên khách hàng cá nhân',
    password: 'Nexus@2026',
    segment: 'rb',
    ...over,
  } as never
}

describe('adding somebody', () => {
  it('creates an account that can sign in straight away', async () => {
    const f = await withAdmin()
    const made = await service.create(f.admin, newSale({ managerId: f.leadRb.id }))

    expect(made.unitId).toBe(f.unit.id)
    expect(made.active).toBe(true)
    expect((await auth.login('SALE-RB-09', 'Nexus@2026')).id).toBe(made.id)
  })

  it('puts them into the chart under the right team lead', async () => {
    const f = await withAdmin()
    await service.create(f.admin, newSale({ managerId: f.leadRb.id, name: 'Người mới' }))

    const tree = await service.tree(f.saleRb)
    expect(find(tree, f.leadRb.name)!.reports.map((node) => node.name)).toContain('Người mới')
  })

  /** The rule that gives the chart its shape, and the one the schema cannot
   *  state: it only insists that somebody is above you, not who. */
  it('refuses a salesperson placed under anyone but a team lead', async () => {
    const f = await withAdmin()

    await expect(
      service.create(f.admin, newSale({ managerId: f.bm.id })),
    ).rejects.toThrow(BadRequestException)
    await expect(
      service.create(f.admin, newSale({ managerId: f.saleRb.id })),
    ).rejects.toThrow(BadRequestException)
  })

  /** A retail salesperson under the SSE team lead would appear in a chart
   *  nobody believes and in a report that counts them on the wrong side. */
  it('refuses a salesperson under the other segment’s team lead', async () => {
    const f = await withAdmin()
    await expect(
      service.create(f.admin, newSale({ segment: 'rb', managerId: f.leadSse.id })),
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses a manager from another branch, or one who has left', async () => {
    const f = await withAdmin()
    const elsewhere = await makeBranch()
    const gone = await makeUser({
      role: 'team_lead',
      segment: 'rb',
      unitId: f.unit.id,
      managerId: f.bm.id,
      active: false,
    })

    await expect(
      service.create(f.admin, newSale({ managerId: elsewhere.leadRb.id })),
    ).rejects.toThrow(BadRequestException)
    await expect(
      service.create(f.admin, newSale({ managerId: gone.id })),
    ).rejects.toThrow(BadRequestException)
  })

  it('refuses a salesperson with no segment and a branch manager with one', async () => {
    const f = await withAdmin()

    await expect(
      service.create(f.admin, newSale({ segment: undefined, managerId: f.leadRb.id })),
    ).rejects.toThrow(BadRequestException)
    await expect(
      service.create(
        f.admin,
        newSale({ role: 'bm', segment: 'rb', managerId: undefined, code: 'BM-02' }),
      ),
    ).rejects.toThrow(BadRequestException)
  })

  it('keeps the admin outside the tree', async () => {
    const f = await withAdmin()
    await expect(
      service.create(
        f.admin,
        newSale({ role: 'admin', segment: 'rb', managerId: undefined, code: 'ADMIN-02' }),
      ),
    ).rejects.toThrow(BadRequestException)
  })

  it('says plainly which handle is already taken', async () => {
    const f = await withAdmin()
    await service.create(f.admin, newSale({ managerId: f.leadRb.id }))

    await expect(
      service.create(f.admin, newSale({ managerId: f.leadRb.id, employeeCode: 'NV0100' })),
    ).rejects.toThrow(/code_taken/)
    await expect(
      service.create(f.admin, newSale({ managerId: f.leadRb.id, code: 'SALE-RB-10' })),
    ).rejects.toThrow(/employee_code_taken/)
  })
})

describe('correcting a record', () => {
  it('changes the plain fields and leaves the rest alone', async () => {
    const f = await withAdmin()
    const after = await service.update(f.admin, f.saleRb.id, {
      name: 'Nguyễn Văn Hải',
      title: 'Chuyên viên cao cấp',
      level: 'cv3',
      phone: '0901234567',
    })

    expect(after.name).toBe('Nguyễn Văn Hải')
    expect(after.level).toBe('cv3')
    expect(after.role).toBe('sale')
    expect(after.managerId).toBe(f.leadRb.id)
  })

  it('moves somebody to a different team lead', async () => {
    const f = await withAdmin()
    const second = await makeUser({
      role: 'team_lead',
      segment: 'rb',
      unitId: f.unit.id,
      managerId: f.bm.id,
      name: 'Nhóm hai',
    })

    await service.update(f.admin, f.saleRb.id, { managerId: second.id })

    const tree = await service.tree(f.bm)
    expect(find(tree, 'Nhóm hai')!.reports.map((n) => n.id)).toEqual([f.saleRb.id])
    expect(find(tree, f.leadRb.name)!.reports).toEqual([])
  })

  /** Demoting somebody who still has people under them would orphan every one
   *  of them: their leads drop out of the chart and out of the chasing that is
   *  the whole job. Move the reports first. */
  it('refuses to demote or switch off a team lead who still has people', async () => {
    const f = await withAdmin()

    await expect(
      service.update(f.admin, f.leadRb.id, { role: 'sale' }),
    ).rejects.toThrow(ConflictException)
    await expect(
      service.update(f.admin, f.leadRb.id, { active: false }),
    ).rejects.toThrow(ConflictException)

    /** Once their last person has moved, it goes through. */
    await service.update(f.admin, f.saleRb.id, { managerId: f.leadSse.id, segment: 'sse' })
    const after = await service.update(f.admin, f.leadRb.id, { active: false })
    expect(after.active).toBe(false)
  })

  /** A book belongs to a segment as much as a person does. Moving somebody
   *  across while they hold the other side's customers would carry those rows
   *  into the wrong team's numbers without touching them. */
  it('refuses a segment change while they still hold customers', async () => {
    const f = await withAdmin()
    await makeCustomer({ ownerId: f.saleRb.id, segment: 'rb' })

    await expect(
      service.update(f.admin, f.saleRb.id, { segment: 'sse', managerId: f.leadSse.id }),
    ).rejects.toThrow(ConflictException)
  })

  it('refuses a move that would break the tier rule', async () => {
    const f = await withAdmin()

    await expect(
      service.update(f.admin, f.saleRb.id, { managerId: f.bm.id }),
    ).rejects.toThrow(BadRequestException)
    await expect(
      service.update(f.admin, f.saleRb.id, { managerId: f.saleRb.id }),
    ).rejects.toThrow(BadRequestException)
  })

  /** The account that can undo any of this. Losing the last one means nobody
   *  can put it back. */
  it('refuses to remove the last admin', async () => {
    const f = await withAdmin()

    await expect(
      service.update(f.admin, f.admin.id, { active: false }),
    ).rejects.toThrow(ConflictException)
    await expect(
      service.update(f.admin, f.admin.id, { role: 'bm', segment: null, managerId: null }),
    ).rejects.toThrow(ConflictException)

    /** With a second admin in place it is allowed. */
    await makeUser({ role: 'admin', unitId: f.unit.id })
    expect((await service.update(f.admin, f.admin.id, { active: false })).active).toBe(false)
  })

  /** Leaving them signed in would make "active" a label rather than a
   *  control. */
  it('signs somebody out everywhere when they are switched off', async () => {
    const f = await withAdmin()
    await testDb.insert(sessions).values({
      id: 'ses_open',
      tokenHash: 'hash-open',
      userId: f.saleRb.id,
      expiresAt: new Date(Date.now() + 60_000),
    })

    await service.update(f.admin, f.saleRb.id, { active: false })
    expect(
      await testDb.select().from(sessions).where(eq(sessions.userId, f.saleRb.id)),
    ).toHaveLength(0)
  })

  it('refuses a handle another account already has', async () => {
    const f = await withAdmin()
    await expect(
      service.update(f.admin, f.saleRb.id, { code: f.saleSse.code }),
    ).rejects.toThrow(/code_taken/)
  })

  it('reports a person who does not exist as missing', async () => {
    const f = await withAdmin()
    await expect(service.update(f.admin, 'nobody', { name: 'X' })).rejects.toThrow(
      NotFoundException,
    )
  })
})

describe('resetting a password', () => {
  it('replaces the old one', async () => {
    const f = await withAdmin()
    await service.setPassword(f.saleRb.id, { password: 'Nexus@2027' })

    expect((await auth.login(f.saleRb.code, 'Nexus@2027')).id).toBe(f.saleRb.id)
    await expect(auth.login(f.saleRb.code, 'test-password')).rejects.toThrow()
  })

  /** A reset that left the old sessions alive would be no reset at all:
   *  whoever prompted it would still be signed in on the device that caused
   *  the problem. */
  it('signs the account out everywhere', async () => {
    const f = await withAdmin()
    await testDb.insert(sessions).values({
      id: 'ses_stale',
      tokenHash: 'hash-stale',
      userId: f.saleRb.id,
      expiresAt: new Date(Date.now() + 60_000),
    })

    await service.setPassword(f.saleRb.id, { password: 'Nexus@2027' })
    expect(
      await testDb.select().from(sessions).where(eq(sessions.userId, f.saleRb.id)),
    ).toHaveLength(0)
  })

  it('leaves everybody else signed in', async () => {
    const f = await withAdmin()
    await testDb.insert(sessions).values({
      id: 'ses_other',
      tokenHash: 'hash-other',
      userId: f.saleSse.id,
      expiresAt: new Date(Date.now() + 60_000),
    })

    await service.setPassword(f.saleRb.id, { password: 'Nexus@2027' })
    expect(await testDb.select().from(sessions)).toHaveLength(1)
  })

  it('never stores the password as given', async () => {
    const f = await withAdmin()
    await service.setPassword(f.saleRb.id, { password: 'Nexus@2027' })

    const [row] = await testDb.select().from(users).where(eq(users.id, f.saleRb.id))
    expect(row.passwordHash).not.toContain('Nexus@2027')
    expect(row.passwordHash.startsWith('$2')).toBe(true)
  })

  it('reports a person who does not exist as missing', async () => {
    await expect(service.setPassword('nobody', { password: 'Nexus@2027' })).rejects.toThrow(
      NotFoundException,
    )
  })
})

describe('the roster', () => {
  /** Not the tree. That one is the org chart and leaves the admin out; this
   *  screen has to show them, because a roster that cannot see the account
   *  doing the looking is a roster with a hole in it. */
  it('includes the admin, which the chart does not', async () => {
    const f = await withAdmin()
    const { rows } = await service.list()

    expect(rows.map((row) => row.id)).toContain(f.admin.id)
    expect(find(await service.tree(f.admin), f.admin.name)).toBeUndefined()
  })

  it('carries the three columns publicUser does not', async () => {
    const f = await withAdmin()
    await service.update(f.admin, f.saleRb.id, {
      email: 'hai@msb.com.vn',
      phone: '0901234567',
    })
    await auth.login(f.saleRb.code, TEST_PASSWORD)

    const row = (await service.list()).rows.find((r) => r.id === f.saleRb.id)!
    expect(row.email).toBe('hai@msb.com.vn')
    expect(row.phone).toBe('0901234567')
    /** How an admin finds the accounts nobody has ever used. */
    expect(row.lastLoginAt).not.toBeNull()
  })

  it('names the manager, so the chart is readable from a flat list', async () => {
    const f = await withAdmin()
    const row = (await service.list()).rows.find((r) => r.id === f.saleRb.id)!
    expect(row.managerName).toBe(f.leadRb.name)
  })

  it('reads top down: branch manager, team leads, salespeople, admin', async () => {
    const f = await withAdmin()
    const roles = (await service.list()).rows.map((row) => row.role)
    expect(roles).toEqual(['bm', 'team_lead', 'team_lead', 'sale', 'sale', 'admin'])
  })

  it('searches the name, both codes, the email and the phone', async () => {
    const f = await withAdmin()
    await service.update(f.admin, f.saleRb.id, {
      email: 'hai@msb.com.vn',
      phone: '0901 234 567',
    })

    for (const q of [f.saleRb.name, f.saleRb.code, f.saleRb.employeeCode, 'hai@msb']) {
      const found = await service.list({ q })
      expect(found.rows.map((r) => r.id), q).toContain(f.saleRb.id)
    }
    /** Nobody types a number the same way twice, so both sides lose spaces. */
    expect((await service.list({ q: '0901234567' })).rows[0].id).toBe(f.saleRb.id)
  })

  it('filters by role and by whether the account still works', async () => {
    const f = await withAdmin()
    await service.update(f.admin, f.saleSse.id, { active: false })

    expect((await service.list({ role: 'team_lead' })).rows).toHaveLength(2)
    expect((await service.list({ active: false })).rows).toHaveLength(1)
    expect((await service.list({ active: true })).rows).toHaveLength(5)
  })

  /** The four figures above the table describe the branch. A headcount that
   *  changed every time somebody typed in the search box would be answering a
   *  different question than the one its label asks. */
  it('counts everybody in the summary, whatever the filter says', async () => {
    const f = await withAdmin()
    await service.update(f.admin, f.saleSse.id, { active: false })

    const narrowed = await service.list({ role: 'sale' })
    expect(narrowed.rows).toHaveLength(2)
    expect(narrowed.summary).toEqual({ total: 6, active: 5, locked: 1, admins: 1 })
  })
})
