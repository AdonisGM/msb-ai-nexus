import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { canAssignTo } from '../auth/scope'
import { DB, type Db } from '../db/db.module'
import {
  BPS_PER_UNIT,
  SALES_ROLES,
  targets,
  users,
  type Target,
  type User,
} from '../db/schema'
import type { ListTargetsDto, SetTargetDto } from './dto'

/** Who owes what, per period.
 *
 *  A small table doing a lot of work: without it there is no gap, and without
 *  a gap the branch manager's screen is a list of numbers with nothing to say.
 *
 *  A unit target is not the sum of its people's. Branches routinely carry a
 *  number larger than what they hand out, so both are stored and neither is
 *  derived from the other. */
@Injectable()
export class TargetsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Targets this person may see.
   *
   *  Everyone sees their unit's number — knowing what the branch is carrying
   *  is not privileged, and hiding it would make a salesperson's own share
   *  look arbitrary. Personal numbers follow the same tree as everything else:
   *  your own, your people's, your unit's. */
  async list(user: User, query: ListTargetsDto = {}): Promise<Target[]> {
    const parts: (SQL | undefined)[] = [this.scopeFor(user)]
    if (query.period) parts.push(eq(targets.period, query.period))
    if (query.scope) parts.push(eq(targets.scope, query.scope))
    if (query.metric) parts.push(eq(targets.metric, query.metric))

    const defined = parts.filter((part): part is SQL => part !== undefined)

    return this.db
      .select()
      .from(targets)
      .where(defined.length > 0 ? and(...defined) : undefined)
      /** Unit numbers first — the context a personal one is read against. */
      .orderBy(asc(targets.period), asc(targets.scope), asc(targets.metric), asc(targets.ownerId))
  }

  /** Sets a number, replacing whatever was there for the same person, segment
   *  and period.
   *
   *  Upsert rather than insert because allocating a quarter is an iterative
   *  conversation, and a second row for the same thing would make the gap
   *  depend on which one a query happened to read first. */
  async set(user: User, body: SetTargetDto): Promise<Target> {
    /** Allocating is the branch manager's job. A team lead arguing for a
     *  different number does it by talking to them, not by editing it. */
    if (user.role !== 'bm' && user.role !== 'admin') {
      throw new ForbiddenException('only_bm_sets_targets')
    }

    const unitId = await this.resolveUnit(user, body)

    const ownerId = body.scope === 'user' ? (body.ownerId ?? null) : null
    const segment = body.segment ?? null
    const metric = body.metric ?? 'cr_rate'

    /** A conversion target above a hundred percent is a typo, and one that
     *  reaches a report makes every gap on it negative. The database refuses
     *  it too; saying so here means the caller gets a sentence rather than a
     *  constraint name. */
    if (metric === 'cr_rate' && body.amount > BPS_PER_UNIT) {
      throw new BadRequestException('cr_rate_above_one_hundred_percent')
    }

    /** Find-then-write rather than an upsert clause: the unique index is an
     *  expression index — it coalesces the nullable columns, because Postgres
     *  treats NULLs as distinct and unit rows have no owner — and Postgres
     *  only accepts plain columns as a conflict target.
     *
     *  The index still has the last word. Two callers racing here means the
     *  second insert is rejected, which the catch turns into the update it
     *  should have been. */
    const existing = await this.db
      .select({ id: targets.id })
      .from(targets)
      .where(
        and(
          eq(targets.scope, body.scope),
          eq(targets.unitId, unitId),
          eq(targets.metric, metric),
          eq(targets.period, body.period),
          ownerId ? eq(targets.ownerId, ownerId) : isNull(targets.ownerId),
          segment ? eq(targets.segment, segment) : isNull(targets.segment),
        ),
      )
      .limit(1)

    if (existing[0]) return this.applyAmount(existing[0].id, body)

    try {
      const [row] = await this.db
        .insert(targets)
        .values({
          id: randomUUID(),
          scope: body.scope,
          ownerId,
          unitId,
          segment,
          metric,
          period: body.period,
          amount: body.amount,
          note: body.note ?? null,
        })
        .returning()

      return row
    } catch (error) {
      const constraint = (error as { constraint_name?: string; cause?: { constraint_name?: string } })
      if ((constraint?.constraint_name ?? constraint?.cause?.constraint_name) !== 'targets_key') {
        throw error
      }

      const [raced] = await this.db
        .select({ id: targets.id })
        .from(targets)
        .where(
          and(
            eq(targets.scope, body.scope),
            eq(targets.unitId, unitId),
            eq(targets.metric, metric),
            eq(targets.period, body.period),
            ownerId ? eq(targets.ownerId, ownerId) : isNull(targets.ownerId),
            segment ? eq(targets.segment, segment) : isNull(targets.segment),
          ),
        )
        .limit(1)

      return this.applyAmount(raced.id, body)
    }
  }

  private async applyAmount(id: string, body: SetTargetDto): Promise<Target> {
    const [row] = await this.db
      .update(targets)
      .set({ amount: body.amount, note: body.note ?? null, updatedAt: new Date() })
      .where(eq(targets.id, id))
      .returning()

    return row
  }

  async remove(user: User, id: string): Promise<void> {
    if (user.role !== 'bm' && user.role !== 'admin') {
      throw new ForbiddenException('only_bm_sets_targets')
    }

    const [gone] = await this.db
      .delete(targets)
      .where(and(eq(targets.id, id), this.scopeFor(user)))
      .returning({ id: targets.id })

    if (!gone) throw new NotFoundException('target_not_found')
  }

  private scopeFor(user: User): SQL | undefined {
    if (user.role === 'admin') return undefined

    /** The unit's own number, visible to everyone in it. */
    const unitNumber = and(eq(targets.unitId, user.unitId), isNull(targets.ownerId))

    if (user.role === 'bm') {
      return eq(targets.unitId, user.unitId)
    }

    const peopleFilter =
      user.role === 'team_lead'
        ? or(eq(users.id, user.id), eq(users.managerId, user.id))
        : eq(users.id, user.id)

    const theirs = inArray(
      targets.ownerId,
      this.db
        .select({ id: users.id })
        .from(users)
        .where(and(peopleFilter, inArray(users.role, [...SALES_ROLES]))),
    )

    return or(unitNumber, theirs)
  }

  /** A personal target lands in that person's unit; a unit target lands in the
   *  caller's own. Deriving it rather than accepting it stops a number being
   *  filed against a branch nobody meant. */
  private async resolveUnit(user: User, body: SetTargetDto): Promise<string> {
    if (body.scope === 'unit') {
      if (body.ownerId) throw new BadRequestException('unit_target_has_no_owner')
      return user.unitId
    }

    if (!body.ownerId) throw new BadRequestException('owner_required')
    if (body.segment) throw new BadRequestException('personal_target_has_no_segment')

    if (!(await canAssignTo(this.db, user, body.ownerId))) {
      throw new ForbiddenException('owner_out_of_scope')
    }

    const [owner] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, body.ownerId))
      .limit(1)

    if (!owner) throw new NotFoundException('owner_not_found')

    /** An admin holds no book and carries no number, so giving one a target
     *  would put a figure in the branch total that nobody can ever deliver. */
    if (owner.role === 'admin') throw new BadRequestException('owner_not_in_sales_line')

    return owner.unitId
  }
}
