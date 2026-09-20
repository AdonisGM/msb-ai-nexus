import { Inject, Injectable } from '@nestjs/common'
import { and, count, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { opportunityScope } from '../auth/scope'
import { DB, type Db } from '../db/db.module'
import { dealsToTarget, rateBps } from '../lib/money'
import {

  customers,
  opportunities,
  targets,
  users,
  type User,
} from '../db/schema'
import type { ReportQuery } from './dto'

/** The branch's own arithmetic, in one place.
 *
 *  Everything here counts rows that already exist — there is no estimate, no
 *  projection and no weighting. The old model had a forecast built on a
 *  probability somebody typed; this has a conversion rate built on deals that
 *  actually landed. When a judge asks where a number comes from, every one of
 *  them is a `count(*)` away from a row somebody can open.
 *
 *  Scoped like every other read: a team lead's report covers their own people,
 *  a branch manager's the whole unit. The same query serves both, and the
 *  difference is entirely in what `opportunityScope` lets through. */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The four steps, and how many leads fell out between each pair.
   *
   *  Counted from the marks rather than from `stage`, because a won lead's
   *  stage stopped moving when it closed while the question "how many were
   *  ever contacted" includes it. */
  async funnel(user: User, query: ReportQuery) {
    const where = this.scope(user, query)

    const [row] = await this.db
      .select({
        leads: count(),
        contacted: sql<number>`count(*) filter (where ${opportunities.contactedAt} is not null)`,
        advised: sql<number>`count(*) filter (where ${opportunities.advisedAt} is not null)`,
        won: sql<number>`count(*) filter (where ${opportunities.outcome} = 'won')`,
        lost: sql<number>`count(*) filter (where ${opportunities.outcome} = 'lost')`,
      })
      .from(opportunities)
      .where(where)

    const leads = Number(row?.leads ?? 0)
    const contacted = Number(row?.contacted ?? 0)
    const advised = Number(row?.advised ?? 0)
    const won = Number(row?.won ?? 0)
    const lost = Number(row?.lost ?? 0)

    const target = await this.crTarget(user)

    /** Which step loses the most, measured rather than assumed. Every step
     *  can be the leak, and a screen that names one without checking is a
     *  screen that sends somebody to fix the wrong thing. */
    const steps = [
      { step: 'contacted' as const, value: contacted, of: leads },
      { step: 'advised' as const, value: advised, of: contacted },
      { step: 'won' as const, value: won, of: advised },
    ].map((s) => ({
      ...s,
      /** Basis points of the previous step, so the three are comparable. */
      keptBps: rateBps(s.value, s.of),
      dropped: Math.max(0, s.of - s.value),
    }))

    const weakest = steps.reduce((worst, s) => (s.keptBps < worst.keptBps ? s : worst), steps[0])

    return {
      leads,
      contacted,
      advised,
      won,
      lost,
      /** In basis points, like the target, so the two compare without either
       *  becoming a float. */
      crBps: rateBps(won, leads),
      targetBps: target,
      gap: dealsToTarget(leads, target, won),
      steps,
      weakestStep: leads > 0 ? weakest.step : null,
    }
  }

  /** One row per salesperson: the funnel, plus the three queues a team lead
   *  chases. */
  async byOwner(user: User, query: ReportQuery) {
    const where = this.scope(user, query)
    const target = await this.crTarget(user)

    const rows = await this.db
      .select({
        ownerId: opportunities.ownerId,
        ownerName: users.name,
        ...FUNNEL_COUNTS,
        ...QUEUE_COUNTS,
      })
      .from(opportunities)
      .innerJoin(users, eq(users.id, opportunities.ownerId))
      .where(where)
      .groupBy(opportunities.ownerId, users.name)

    /** How many customers each of them holds. A separate query rather than a
     *  join, because joining a one-to-many onto a one-to-many multiplies the
     *  lead counts above by the size of the book. */
    const books = await this.customerCounts(user)

    return rows
      .map((row) => ({
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        customers: books.get(row.ownerId) ?? 0,
        ...this.withRate(row, target),
      }))
      .sort((a, b) => b.won - a.won || a.ownerName.localeCompare(b.ownerName, 'vi'))
  }

  /** One row per team, grouped by the team lead each salesperson reports to.
   *
   *  A team lead who holds leads of their own is counted under themselves,
   *  which is right: it is their book, and their manager reads it as part of
   *  the branch either way. */
  async byTeam(user: User, query: ReportQuery) {
    const where = this.scope(user, query)
    const target = await this.crTarget(user)
    const lead = alias(users, 'lead')

    const rows = await this.db
      .select({
        /** Whose team this lead belongs to, which is not the same as who the
         *  owner reports to. A salesperson's team is their manager's; a team
         *  lead's own book is their own team, not their branch manager's.
         *  Grouping on `manager_id` alone put a team lead's leads under the
         *  BM as a separate row, which is how a branch appears to have one
         *  team more than it has. */
        leadId: sql<string>`case when ${users.role} = 'sale' then ${users.managerId} else ${users.id} end`.as('lead_id'),
        leadName: sql<string>`case when ${users.role} = 'sale' then ${lead.name} else ${users.name} end`.as('lead_name'),
        segment: opportunities.segment,
        ...FUNNEL_COUNTS,
        ...QUEUE_COUNTS,
      })
      .from(opportunities)
      .innerJoin(users, eq(users.id, opportunities.ownerId))
      .leftJoin(lead, eq(lead.id, users.managerId))
      .where(where)
      .groupBy(sql`1`, sql`2`, opportunities.segment)

    const heads = await this.headcounts(user)

    return rows
      .map((row) => ({
        leadId: row.leadId,
        leadName: row.leadName,
        segment: row.segment,
        heads: heads.get(row.leadId) ?? 0,
        ...this.withRate(row, target),
      }))
      .sort((a, b) => b.crBps - a.crBps)
  }

  /** Counts grouped by one closed-set column.
   *
   *  One endpoint for three groupings because the shape is identical and the
   *  only difference is which column to group on — three near-copies would be
   *  three places to fix the next time the scope rule changes. */
  async breakdown(user: User, query: ReportQuery, by: 'product' | 'blocker' | 'segment') {
    const where = this.scope(user, query)

    const column =
      by === 'product'
        ? opportunities.product
        : by === 'blocker'
          ? opportunities.blockerCode
          : opportunities.segment

    const rows = await this.db
      .select({
        key: column,
        total: count(),
        won: sql<number>`count(*) filter (where ${opportunities.outcome} = 'won')`,
        lost: sql<number>`count(*) filter (where ${opportunities.outcome} = 'lost')`,
        value: sql<number>`coalesce(sum(${opportunities.value}), 0)`.mapWith(Number),
      })
      /** A lead with no blocker is not a category; it is the absence of one,
       *  and counting it as "chưa rõ" would make the biggest slice of the
       *  chart the one that says nothing. */
      .from(opportunities)
      .where(by === 'blocker' ? and(where, isNotNull(opportunities.blockerCode)) : where)
      .groupBy(column)

    const total = rows.reduce((sum, row) => sum + Number(row.total), 0)

    return rows
      .filter((row) => row.key !== null)
      .map((row) => ({
        key: row.key as string,
        total: Number(row.total),
        won: Number(row.won),
        lost: Number(row.lost),
        value: Number(row.value),
        /** Of everything in this breakdown, not of every lead — the blocker
         *  chart excludes leads with none, so its shares must add to a hundred
         *  across the rows actually drawn. */
        shareBps: rateBps(Number(row.total), total),
        winBps: rateBps(Number(row.won), Number(row.won) + Number(row.lost)),
      }))
      .sort((a, b) => b.total - a.total)
  }

  /** Wins per calendar month, for the trend.
   *
   *  Dated by when the lead closed rather than when it was raised: a deal
   *  landed in September belongs to September's figures however long it took
   *  to get there.
   *
   *  Only the months that have something in them. A chart padded out to
   *  twelve bars, eleven of them empty, says the branch collapsed rather than
   *  that the system is new. */
  async monthly(user: User, query: ReportQuery) {
    const scope = opportunityScope(this.db, user)
    const parts: (SQL | undefined)[] = [scope, eq(opportunities.outcome, 'won')]
    if (query.segment) parts.push(eq(opportunities.segment, query.segment))
    if (query.ownerId) parts.push(eq(opportunities.ownerId, query.ownerId))
    if (query.from) parts.push(gte(opportunities.closedAt, new Date(query.from)))
    if (query.to) parts.push(lt(opportunities.closedAt, endOf(query.to)))

    const defined = parts.filter((part): part is SQL => part !== undefined)

    const rows = await this.db
      .select({
        month: sql<string>`to_char(${opportunities.closedAt}, 'YYYY-MM')`.as('month'),
        won: count(),
        value: sql<number>`coalesce(sum(${opportunities.value}), 0)`.mapWith(Number),
      })
      .from(opportunities)
      .where(and(...defined))
      .groupBy(sql`1`)
      .orderBy(sql`1`)

    return rows.map((row) => ({
      month: row.month,
      won: Number(row.won),
      value: Number(row.value),
    }))
  }

  /** The conversion rate this person is measured against, in basis points.
   *
   *  Read from `targets` rather than hard-coded, because it is a number the
   *  branch sets and will change. Falls back to the 6% the report is built
   *  around when nobody has set one — a gap column that silently reads zero
   *  would say every branch is on target. */
  private async crTarget(user: User): Promise<number> {
    const [row] = await this.db
      .select({ amount: targets.amount })
      .from(targets)
      .where(
        and(
          eq(targets.unitId, user.unitId),
          eq(targets.metric, 'cr_rate'),
          eq(targets.scope, 'unit'),
          isNull(targets.segment),
        ),
      )
      .limit(1)

    return Number(row?.amount ?? DEFAULT_CR_BPS)
  }

  private scope(user: User, query: ReportQuery): SQL | undefined {
    const parts: (SQL | undefined)[] = [opportunityScope(this.db, user)]
    if (query.segment) parts.push(eq(opportunities.segment, query.segment))
    if (query.ownerId) parts.push(eq(opportunities.ownerId, query.ownerId))
    /** Dated by when the lead was raised. A report about September answers
     *  "what did September bring us", and a lead that arrived in August is
     *  August's however long it stays open. */
    if (query.from) parts.push(gte(opportunities.createdAt, new Date(query.from)))
    if (query.to) parts.push(lt(opportunities.createdAt, endOf(query.to)))

    const defined = parts.filter((part): part is SQL => part !== undefined)
    return defined.length > 0 ? and(...defined) : undefined
  }

  private async customerCounts(user: User) {
    const rows = await this.db
      .select({ ownerId: customers.ownerId, total: count() })
      .from(customers)
      .groupBy(customers.ownerId)

    void user
    return new Map(rows.map((row) => [row.ownerId, Number(row.total)]))
  }

  private async headcounts(user: User) {
    const rows = await this.db
      .select({ leadId: users.managerId, total: count() })
      .from(users)
      .where(and(eq(users.unitId, user.unitId), eq(users.role, 'sale'), eq(users.active, true)))
      .groupBy(users.managerId)

    return new Map(rows.map((row) => [row.leadId ?? '', Number(row.total)]))
  }

  /** Turns raw counts into the two figures every row on every dashboard is
   *  read through: the rate, and how many wins still separate it from the
   *  target.
   *
   *  Numbers only. Who the row is about is the caller's business — one report
   *  groups by salesperson and another by team lead, and a shared helper that
   *  guessed at the identity column silently returned an empty name for one
   *  of them. */
  private withRate(row: Record<string, unknown>, targetBps: number) {
    const leads = Number(row.leads ?? 0)
    const won = Number(row.won ?? 0)

    return {
      leads,
      contacted: Number(row.contacted ?? 0),
      advised: Number(row.advised ?? 0),
      won,
      lost: Number(row.lost ?? 0),
      open: Number(row.open ?? 0),
      overdue: Number(row.overdue ?? 0),
      stale: Number(row.stale ?? 0),
      untouched: Number(row.untouched ?? 0),
      crBps: rateBps(won, leads),
      targetBps,
      gap: dealsToTarget(leads, targetBps, won),
    }
  }
}

/** 6%, the rate the branch report is built around. Only used when nobody has
 *  set a target — see `crTarget`. */
const DEFAULT_CR_BPS = 600

const FUNNEL_COUNTS = {
  leads: count(),
  contacted: sql<number>`count(*) filter (where ${opportunities.contactedAt} is not null)`,
  advised: sql<number>`count(*) filter (where ${opportunities.advisedAt} is not null)`,
  won: sql<number>`count(*) filter (where ${opportunities.outcome} = 'won')`,
  lost: sql<number>`count(*) filter (where ${opportunities.outcome} = 'lost')`,
}

/** The three queues a team lead works from, defined once so the dashboard and
 *  the lists behind it can never disagree about what "quá hạn" means.
 *
 *  `stale` is seven days, which is the design's number rather than one the
 *  branch has agreed — same caveat as everywhere else it appears. */
const QUEUE_COUNTS = {
  open: sql<number>`count(*) filter (where ${opportunities.outcome} = 'open')`,
  overdue: sql<number>`count(*) filter (
    where ${opportunities.outcome} = 'open'
      and ${opportunities.dueDate} is not null
      and ${opportunities.dueDate} < current_date
  )`,
  stale: sql<number>`count(*) filter (
    where ${opportunities.outcome} = 'open'
      and coalesce(${opportunities.advisedAt}, ${opportunities.contactedAt}, ${opportunities.createdAt})
          < now() - interval '7 days'
  )`,
  untouched: sql<number>`count(*) filter (
    where ${opportunities.outcome} = 'open' and ${opportunities.contactedAt} is null
  )`,
}

/** A date range's upper end is the day after, exclusive: `to=2026-09-20` has
 *  to include everything that happened on the twentieth. */
function endOf(day: string): Date {
  const date = new Date(day)
  date.setDate(date.getDate() + 1)
  return date
}

