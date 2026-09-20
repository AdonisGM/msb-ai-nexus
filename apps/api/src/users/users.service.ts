import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import { and, asc, count, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { SessionService } from '../auth/session.service'
import { DB, type Db } from '../db/db.module'
import { isUniqueViolation } from '../lib/db-errors'
import {
  SALES_ROLES,
  customers,
  opportunities,
  users,
  type Role,
  type User,
} from '../db/schema'
import type { CreateUserDto, ListUsersDto, SetPasswordDto, UpdateUserDto } from './dto'

/** Who each role answers to. The schema only insists that a salesperson or a
 *  team lead has *somebody* above them; this says who, and it is what makes
 *  the chart a chart rather than a list of edges.
 *
 *  It also makes a loop impossible to write. A salesperson reports to a team
 *  lead, a team lead to a branch manager, and a branch manager to nobody — so
 *  every chain is at most three deep and terminates. Without this rule a cycle
 *  would be catastrophically quiet: two people managing each other would both
 *  find a parent, neither would become a root, and both would vanish from the
 *  tree with nothing raised anywhere. */
const REPORTS_TO: Record<Role, Role | null> = {
  sale: 'team_lead',
  team_lead: 'bm',
  bm: null,
  admin: null,
}

/** Cost 10, matching the seed. bcrypt is deliberately slow and this runs once
 *  per reset, so there is nothing to gain by lowering it. */
const HASH_ROUNDS = 10

/** One person as the org chart shows them. Codes, never words — the web app
 *  owns the dictionary that turns `sale` into something readable. */
export type TreeNode = {
  id: string
  code: string
  employeeCode: string
  name: string
  role: string
  title: string
  level: string | null
  segment: string | null
  active: boolean
  reports: TreeNode[]
}

/** The branch's own shape: a branch manager at the root, team leads under
 *  them, salespeople under those.
 *
 *  The tree already exists in the schema — `users.manager_id` points back at
 *  the same table, and three check constraints keep it honest. This only reads
 *  it out.
 *
 *  Deliberately **not** scoped by `ownerFilter`. That filter answers "whose
 *  records may I open", and running an org chart through it would show a
 *  salesperson nobody but themselves — which is precisely the gap this exists
 *  to close. Who your manager is, and who else is on your team, is not
 *  confidential inside a branch; whose leads you may read still is, and that
 *  rule is untouched in `opportunityScope`.
 *
 *  The admin never appears. It is a technical account that sits outside the
 *  sales line by constraint, and putting it in the chart would make every
 *  branch look one head larger than it is. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sessions: SessionService,
  ) {}

  /** The whole sales tree of one person's branch.
   *
   *  An admin has a unit like anyone else, so they get that unit's tree and
   *  can use it to place an unassigned lead. */
  async tree(user: User): Promise<TreeNode[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.unitId, user.unitId), inArray(users.role, [...SALES_ROLES])))
      /** Team leads before their own people, then by the display order the
       *  branch chose, then by name so the list never shuffles between two
       *  reads of the same data. */
      .orderBy(asc(users.sort), asc(users.name))

    const nodes = new Map<string, TreeNode>(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          code: row.code,
          employeeCode: row.employeeCode,
          name: row.name,
          role: row.role,
          title: row.title,
          level: row.level,
          segment: row.segment,
          active: row.active,
          reports: [],
        },
      ]),
    )

    const roots: TreeNode[] = []
    for (const row of rows) {
      const node = nodes.get(row.id)!
      /** Anyone whose manager is outside this unit — or missing — is a root
       *  here. Without that fallback a branch with a gap in its tree would
       *  return an empty chart rather than a visibly incomplete one, and the
       *  screen would say nothing is wrong. */
      const parent = row.managerId ? nodes.get(row.managerId) : undefined
      if (parent) parent.reports.push(node)
      else roots.push(node)
    }

    return roots
  }

  /** Everybody on the books, flat, for the admin's roster screen.
   *
   *  Not the tree: that one is the org chart and deliberately leaves the admin
   *  out, while this screen has to show them — a roster that cannot see the
   *  account doing the looking is a roster with a hole in it.
   *
   *  The three columns the screen needs and `publicUser` does not carry come
   *  back here: an email to write to, a number to ring, and when they were
   *  last seen. `lastLoginAt` is the one that earns its place — it is how an
   *  admin finds the accounts nobody has ever used. */
  async list(query: ListUsersDto = {}) {
    const manager = alias(users, 'manager')

    const parts: SQL[] = []
    if (query.role) parts.push(eq(users.role, query.role))
    if (query.active !== undefined) parts.push(eq(users.active, query.active))
    if (query.q) {
      const like = `%${query.q}%`
      parts.push(
        sql`(unaccent(${users.name}) ilike unaccent(${like})
             or ${users.code} ilike ${like}
             or ${users.employeeCode} ilike ${like}
             or coalesce(${users.email}, '') ilike ${like}
             or replace(coalesce(${users.phone}, ''), ' ', '') ilike replace(${like}, ' ', ''))`,
      )
    }

    const rows = await this.db
      .select({
        id: users.id,
        code: users.code,
        employeeCode: users.employeeCode,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        title: users.title,
        level: users.level,
        segment: users.segment,
        managerId: users.managerId,
        managerName: manager.name,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .leftJoin(manager, eq(manager.id, users.managerId))
      .where(parts.length > 0 ? and(...parts) : undefined)
      /** Branch manager, then team leads, then salespeople, then the admin —
       *  the order somebody reads an organisation in. `sort` and the name
       *  break the ties so two reads never disagree. */
      .orderBy(sql`array_position(array['bm','team_lead','sale','admin'], ${users.role})`,
        asc(users.sort), asc(users.name))

    /** Counted across everybody, not across the filter: the four figures above
     *  the table describe the branch, and a headcount that changed every time
     *  somebody typed in the search box would be answering a different
     *  question than the one its label asks. */
    const [totals] = await this.db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${users.active})`,
        locked: sql<number>`count(*) filter (where not ${users.active})`,
        admins: sql<number>`count(*) filter (where ${users.role} = 'admin')`,
      })
      .from(users)

    return {
      rows,
      summary: {
        total: Number(totals?.total ?? 0),
        active: Number(totals?.active ?? 0),
        locked: Number(totals?.locked ?? 0),
        admins: Number(totals?.admins ?? 0),
      },
    }
  }

  async get(id: string): Promise<User> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!row) throw new NotFoundException('user_not_found')
    return row
  }

  /** Adds somebody to a branch.
   *
   *  The new account lands in the admin's own unit. One branch is all the
   *  trial runs, and picking a unit from a list of one is a field that can
   *  only be got wrong. */
  async create(actor: User, body: CreateUserDto): Promise<User> {
    const role = body.role as Role
    const segment = body.segment ?? null
    const managerId = body.managerId ?? null

    await this.assertShape({ role, segment, managerId, unitId: actor.unitId })

    try {
      const [row] = await this.db
        .insert(users)
        .values({
          id: randomUUID(),
          code: body.code,
          employeeCode: body.employeeCode,
          name: body.name,
          role,
          title: body.title,
          level: body.level ?? null,
          segment,
          managerId,
          unitId: actor.unitId,
          email: body.email ?? null,
          phone: body.phone ?? null,
          sort: body.sort ?? 0,
          passwordHash: await hash(body.password, HASH_ROUNDS),
        })
        .returning()

      return row
    } catch (error) {
      throw this.asTakenError(error)
    }
  }

  /** Corrects somebody's record.
   *
   *  Most of what this method is made of has nothing to do with writing the
   *  row — it is the handful of edits that the database would happily accept
   *  and that would quietly break something downstream. */
  async update(actor: User, id: string, body: UpdateUserDto): Promise<User> {
    const before = await this.get(id)

    const role = (body.role ?? before.role) as Role
    const segment = body.segment === undefined ? before.segment : body.segment
    const managerId = body.managerId === undefined ? before.managerId : body.managerId
    const active = body.active === undefined ? before.active : body.active

    /** What this edit would break comes before whether it is well formed.
     *
     *  Both orders reject the same edits, but only one says the useful thing
     *  first: demoting a team lead who still has five people reads as
     *  "manager_wrong_tier" if the shape is checked first, which sends the
     *  admin off to fix a manager field when the actual job is to move five
     *  people. Consequences first, grammar second. */

    /** Demoting or switching off somebody who still has people under them
     *  would orphan every one of them: their leads drop out of the chart, out
     *  of their manager's list, and out of the chasing that is the whole job.
     *  Move the reports first, then change the person. */
    const losesTeam = (before.role === 'team_lead' || before.role === 'bm') &&
      (role !== before.role || !active)
    if (losesTeam) {
      const reports = await this.countReports(id)
      if (reports > 0) throw new ConflictException('user_still_has_reports')
    }

    /** A book belongs to a segment as much as a person does. Moving somebody
     *  across while they hold the other side's customers would carry those
     *  rows into the wrong team's numbers without touching them. */
    if (segment !== before.segment) {
      const held = await this.countBook(id)
      if (held > 0) throw new ConflictException('user_still_holds_customers')
    }

    /** The account that can undo any of this. Losing the last one means
     *  nobody can put it back. */
    if (before.role === 'admin' && (role !== 'admin' || !active)) {
      const others = await this.countOtherActiveAdmins(id)
      if (others === 0) throw new ConflictException('last_admin')
    }

    await this.assertShape({ role, segment, managerId, unitId: before.unitId, self: id })

    const patch = {
      ...(body.code !== undefined && { code: body.code }),
      ...(body.employeeCode !== undefined && { employeeCode: body.employeeCode }),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.level !== undefined && { level: body.level }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.sort !== undefined && { sort: body.sort }),
      role,
      segment,
      managerId,
      active,
      updatedAt: new Date(),
    }

    try {
      const [row] = await this.db
        .update(users)
        .set(patch)
        .where(eq(users.id, id))
        .returning()

      /** Somebody switched off keeps none of their sessions. Leaving them
       *  signed in makes "active" a label rather than a control. */
      if (!row.active && before.active) await this.sessions.revokeAllFor(id)

      return row
    } catch (error) {
      throw this.asTakenError(error)
    }
  }

  /** Hands somebody a new password and signs them out everywhere. */
  async setPassword(id: string, body: SetPasswordDto): Promise<void> {
    await this.get(id)

    await this.db
      .update(users)
      .set({ passwordHash: await hash(body.password, HASH_ROUNDS), updatedAt: new Date() })
      .where(eq(users.id, id))

    await this.sessions.revokeAllFor(id)
  }

  /** The rules the database cannot state on its own.
   *
   *  Three of its four checks are about a single row — a salesperson has a
   *  segment, an admin has neither segment nor manager. What it cannot see is
   *  the row the manager points at: whether that person exists, sits in the
   *  same branch, and is the right tier to be managing anyone. */
  private async assertShape(shape: {
    role: Role
    segment: string | null
    managerId: string | null
    unitId: string
    self?: string
  }) {
    const wants = REPORTS_TO[shape.role]

    if (shape.role === 'admin' && (shape.segment || shape.managerId)) {
      throw new BadRequestException('admin_sits_outside_the_tree')
    }
    if ((shape.role === 'sale' || shape.role === 'team_lead') && !shape.segment) {
      throw new BadRequestException('segment_required')
    }
    if (shape.role === 'bm' && shape.segment) {
      throw new BadRequestException('bm_covers_the_whole_unit')
    }

    if (!wants) {
      if (shape.managerId) throw new BadRequestException('role_reports_to_nobody')
      return
    }

    if (!shape.managerId) throw new BadRequestException('manager_required')
    if (shape.managerId === shape.self) throw new BadRequestException('manager_is_self')

    const [manager] = await this.db
      .select({ role: users.role, unitId: users.unitId, segment: users.segment, active: users.active })
      .from(users)
      .where(eq(users.id, shape.managerId))
      .limit(1)

    if (!manager) throw new BadRequestException('manager_not_found')
    if (manager.role !== wants) throw new BadRequestException('manager_wrong_tier')
    if (manager.unitId !== shape.unitId) throw new BadRequestException('manager_in_another_unit')
    if (!manager.active) throw new BadRequestException('manager_inactive')

    /** A retail salesperson under the SSE team lead would appear in a chart
     *  nobody believes and in a report that counts them twice over. */
    if (shape.role === 'sale' && manager.segment !== shape.segment) {
      throw new BadRequestException('manager_in_another_segment')
    }
  }

  private async countReports(id: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.managerId, id), eq(users.active, true)))
    return Number(row?.total ?? 0)
  }

  /** Customers and leads together: either one is enough to make a segment
   *  change or a handover the wrong move to make quietly. */
  private async countBook(id: string): Promise<number> {
    const [[held], [working]] = await Promise.all([
      this.db.select({ total: count() }).from(customers).where(eq(customers.ownerId, id)),
      this.db
        .select({ total: count() })
        .from(opportunities)
        .where(eq(opportunities.ownerId, id)),
    ])
    return Number(held?.total ?? 0) + Number(working?.total ?? 0)
  }

  private async countOtherActiveAdmins(id: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id)))
    return Number(row?.total ?? 0)
  }

  /** A clash on either unique column, said in the caller's terms rather than
   *  as a driver error the web app would have to parse. */
  private asTakenError(error: unknown): unknown {
    if (isUniqueViolation(error, 'users_code_unique')) {
      return new ConflictException('code_taken')
    }
    if (isUniqueViolation(error, 'users_employee_code_unique')) {
      return new ConflictException('employee_code_taken')
    }
    return error
  }
}
