import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { and, count, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { alias, type PgColumn } from 'drizzle-orm/pg-core'
import { opportunityScope } from '../auth/scope'
import { DB, type Db } from '../db/db.module'
import { dealsToTarget, rateBps } from '../lib/money'
import {
  BPS_PER_UNIT,
  customers,
  opportunities,
  targets,
  users,
  type User,
} from '../db/schema'
import { IS_OVERDUE, IS_STALE, IS_UNTOUCHED, LAST_TOUCH } from '../lib/lead-sql'
import type { ReportQuery } from './dto'

/** One calendar month of the trend, before the target arithmetic is added. */
type MonthRow = { month: string; leads: number; won: number; lost: number; value: number }

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

        /** The same leads again, split so the parts add up to the whole
         *  instead of nesting.
         *
         *  The four counts above are cumulative — every won lead was also
         *  contacted — which is right for a funnel and wrong for anything that
         *  divides a total into shares. Drawn as slices they would sum to far
         *  more than `leads` and each share would be a lie. These five are
         *  disjoint by construction: an open lead is at exactly one stage, and
         *  a closed one is in exactly one outcome. */
        openNew: sql<number>`count(*) filter (
          where ${opportunities.outcome} = 'open' and ${opportunities.contactedAt} is null
        )`,
        openContacted: sql<number>`count(*) filter (
          where ${opportunities.outcome} = 'open'
            and ${opportunities.contactedAt} is not null
            and ${opportunities.advisedAt} is null
        )`,
        openAdvised: sql<number>`count(*) filter (
          where ${opportunities.outcome} = 'open' and ${opportunities.advisedAt} is not null
        )`,
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

      /** Where every lead stands, in parts that add to `leads`. Ordered as the
       *  work runs, so a chart drawn straight off it reads left to right the
       *  way the branch talks about it. */
      standing: [
        { state: 'new' as const, value: Number(row?.openNew ?? 0) },
        { state: 'contacted' as const, value: Number(row?.openContacted ?? 0) },
        { state: 'advised' as const, value: Number(row?.openAdvised ?? 0) },
        { state: 'won' as const, value: won },
        { state: 'lost' as const, value: lost },
      ].map((part) => ({ ...part, shareBps: rateBps(part.value, leads) })),
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

  /** How each calendar month went: what was decided in it, and how that
   *  compares with what the month was asked for.
   *
   *  Two different dates, deliberately, because the branch reads the month
   *  that way:
   *
   *  - `won` and `lost` are dated by **when the lead closed**. A deal landed
   *    in September is September's however long it took to get there, and a
   *    salesperson is paid for the month they closed it in.
   *  - `leads` is dated by **when the lead was raised**, because that is what
   *    the month was handed and what its target is set against.
   *
   *  So `targetWon` is the month's own lead intake at the branch's conversion
   *  rate — not a quarterly target cut into three, which would draw a line
   *  nobody agreed to. A month that closed more than its intake asked for goes
   *  over a hundred percent, and should.
   *
   *  Only the months that have something in them. A chart padded out to twelve
   *  bars, eleven of them empty, says the branch collapsed rather than that
   *  the system is new. */
  async monthly(user: User, query: ReportQuery) {
    const scope = opportunityScope(this.db, user)
    const target = await this.crTarget(user)

    /** Everything but the dates, which is the one thing the two halves below
     *  disagree about. */
    const common: (SQL | undefined)[] = [scope]
    if (query.segment) common.push(eq(opportunities.segment, query.segment))
    if (query.ownerId) common.push(eq(opportunities.ownerId, query.ownerId))

    const within = (column: PgColumn) => {
      const parts = [...common]
      if (query.from) parts.push(gte(column, new Date(query.from)))
      if (query.to) parts.push(lt(column, endOf(query.to)))
      return and(...parts.filter((part): part is SQL => part !== undefined))
    }

    const closed = await this.db
      .select({
        month: sql<string>`to_char(${opportunities.closedAt}, 'YYYY-MM')`.as('month'),
        won: sql<number>`count(*) filter (where ${opportunities.outcome} = 'won')`.mapWith(Number),
        lost: sql<number>`count(*) filter (where ${opportunities.outcome} = 'lost')`.mapWith(
          Number,
        ),
        value: sql<number>`coalesce(sum(${opportunities.value}) filter (where ${opportunities.outcome} = 'won'), 0)`.mapWith(
          Number,
        ),
      })
      .from(opportunities)
      .where(and(isNotNull(opportunities.closedAt), within(opportunities.closedAt)))
      .groupBy(sql`1`)

    const raised = await this.db
      .select({
        month: sql<string>`to_char(${opportunities.createdAt}, 'YYYY-MM')`.as('month'),
        leads: count(),
      })
      .from(opportunities)
      .where(within(opportunities.createdAt))
      .groupBy(sql`1`)

    const byMonth = new Map<string, MonthRow>()
    const at = (month: string) => {
      const found = byMonth.get(month) ?? { month, leads: 0, won: 0, lost: 0, value: 0 }
      byMonth.set(month, found)
      return found
    }

    for (const row of closed) {
      const month = at(row.month)
      month.won = Number(row.won)
      month.lost = Number(row.lost)
      month.value = Number(row.value)
    }
    for (const row of raised) at(row.month).leads = Number(row.leads)

    return [...byMonth.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row) => {
        /** What this month's intake asks for, at the branch's rate. Rounded
         *  to whole deals because half a deal cannot be closed. */
        const targetWon = Math.round((row.leads * target) / BPS_PER_UNIT)
        return {
          ...row,
          targetBps: target,
          targetWon,
          /** Zero rather than infinity in a month that took no leads at all:
           *  nothing was asked of it, so nothing is outstanding. */
          doneBps: rateBps(row.won, targetWon),
        }
      })
  }

  /** Where the period lands if it carries on as it has been going.
   *
   *  The one projection in this file, and it is built the way everything else
   *  here is: from deals that actually closed. The model this replaced held a
   *  probability somebody typed into a field, which meant the forecast moved
   *  when a salesperson felt optimistic. These rates come out of the branch's
   *  own closed leads and move only when the branch does.
   *
   *  **Two estimates, and both of them are rates.** This took a wrong turn
   *  worth recording. The obvious second estimate is the open pipeline
   *  weighted by each stage's win rate — but that answers "what is the open
   *  book worth", which is a stock, while the question is a flow: how many
   *  deals land between now and the end of the period. On the real branch it
   *  said 66 against a run rate of 25, because 405 open leads at 9% is 37 more
   *  wins whether they land next week or next year. Filtering to the leads old
   *  enough to be due moved it to 58 and did not fix anything, because the
   *  mistake was the unit, not the count.
   *
   *  So both estimates are wins per day, measured over different windows and
   *  applied to the days that are left:
   *
   *  - `fromRunRate` — this period's own pace, over the whole period.
   *  - `fromHistory` — the trailing year's pace, over the days remaining.
   *
   *  They disagree when the quarter is running hotter or colder than the year,
   *  which is the thing a branch manager actually wants to know. Reporting the
   *  range is honest; picking one and printing it to the deal would not be.
   *
   *  The stage weighting survives as `pipeline.worth`: what the open book is
   *  worth *eventually*, which is a real number and a useful one, as long as
   *  nobody reads it as this quarter's.
   *
   *  `basis` carries how many closed deals the rates were measured from, so a
   *  screen can refuse to draw a confident line through four data points. */
  async forecast(user: User, query: ReportQuery) {
    if (!query.from || !query.to) throw new BadRequestException('period_required')

    const from = new Date(query.from)
    const to = endOf(query.to)
    const slice = this.slice(user, query)

    const [landed] = await this.db
      .select({
        won: sql<number>`count(*) filter (where ${opportunities.outcome} = 'won')`.mapWith(Number),
        lost: sql<number>`count(*) filter (where ${opportunities.outcome} = 'lost')`.mapWith(Number),
        value: sql<number>`coalesce(sum(${opportunities.value}) filter (
          where ${opportunities.outcome} = 'won'
        ), 0)`.mapWith(Number),
      })
      .from(opportunities)
      .where(and(...slice, gte(opportunities.closedAt, from), lt(opportunities.closedAt, to)))

    /** The intake the target is measured against. Same definition as
     *  `monthly`: a lead belongs to the period it was raised in. */
    const [intake] = await this.db
      .select({ leads: count() })
      .from(opportunities)
      .where(and(...slice, gte(opportunities.createdAt, from), lt(opportunities.createdAt, to)))

    /** Everything still open, at whatever stage it has reached — not only what
     *  was raised inside the period. A lead from August can close in September
     *  and counts towards September when it does. */
    const [pipeline] = await this.db
      .select({
        ...STAGE_COUNTS,
        value: sql<number>`coalesce(sum(${opportunities.value}), 0)`.mapWith(Number),
      })
      .from(opportunities)
      .where(and(...slice, eq(opportunities.outcome, 'open')))

    /** How the branch has actually converted, measured over the year up to the
     *  end of the period. A year rather than all of it, because a rate from
     *  two restructures ago is not this branch's rate any more. */
    const [history] = await this.db
      .select({
        closed: count(),
        won: sql<number>`count(*) filter (where ${opportunities.outcome} = 'won')`.mapWith(Number),
        reachedContacted: sql<number>`count(*) filter (
          where ${opportunities.contactedAt} is not null
        )`.mapWith(Number),
        wonFromContacted: sql<number>`count(*) filter (
          where ${opportunities.contactedAt} is not null and ${opportunities.outcome} = 'won'
        )`.mapWith(Number),
        reachedAdvised: sql<number>`count(*) filter (
          where ${opportunities.advisedAt} is not null
        )`.mapWith(Number),
        wonFromAdvised: sql<number>`count(*) filter (
          where ${opportunities.advisedAt} is not null and ${opportunities.outcome} = 'won'
        )`.mapWith(Number),

        /** How long a winning deal takes, per stage reached. The denominator
         *  of the "is this lead due" question below. Null when the branch has
         *  never won one from that stage — in which case its win rate is zero
         *  too, and nothing it weights can be nonzero either. */
        daysToWin: sql<number | null>`percentile_cont(0.5) within group (
          order by extract(epoch from ${opportunities.closedAt} - ${opportunities.createdAt}) / 86400
        ) filter (where ${opportunities.outcome} = 'won')`,
        daysToWinContacted: sql<number | null>`percentile_cont(0.5) within group (
          order by extract(epoch from ${opportunities.closedAt} - ${opportunities.createdAt}) / 86400
        ) filter (
          where ${opportunities.outcome} = 'won' and ${opportunities.contactedAt} is not null
        )`,
        daysToWinAdvised: sql<number | null>`percentile_cont(0.5) within group (
          order by extract(epoch from ${opportunities.closedAt} - ${opportunities.createdAt}) / 86400
        ) filter (
          where ${opportunities.outcome} = 'won' and ${opportunities.advisedAt} is not null
        )`,
      })
      .from(opportunities)
      .where(
        and(
          ...slice,
          isNotNull(opportunities.closedAt),
          gte(opportunities.closedAt, yearBefore(to)),
          lt(opportunities.closedAt, to),
        ),
      )

    /** The clock. Elapsed is clamped into the period so a forecast asked for a
     *  quarter that has not started yet, or one that finished last year, does
     *  not divide by a negative number of days. */
    const days = daysBetween(from, to)
    const elapsed = Math.min(days, Math.max(0, daysBetween(from, startOfToday())))
    const remaining = days - elapsed
    const fromRunRate =
      elapsed > 0 ? Math.round((Number(landed?.won ?? 0) * days) / elapsed) : Number(landed?.won ?? 0)

    /** Three conditional rates: given a lead reached this stage, how often did
     *  it end up won. A lead sitting at "contacted" is compared against every
     *  lead that ever reached "contacted", including the ones that went on to
     *  be advised — from where it stands now, that is the question. */
    const measured = [
      {
        stage: 'new' as const,
        open: Number(pipeline?.openNew ?? 0),
        won: Number(history?.won ?? 0),
        of: Number(history?.closed ?? 0),
        medianDays: numberOrNull(history?.daysToWin),
      },
      {
        stage: 'contacted' as const,
        open: Number(pipeline?.openContacted ?? 0),
        won: Number(history?.wonFromContacted ?? 0),
        of: Number(history?.reachedContacted ?? 0),
        medianDays: numberOrNull(history?.daysToWinContacted),
      },
      {
        stage: 'advised' as const,
        open: Number(pipeline?.openAdvised ?? 0),
        won: Number(history?.wonFromAdvised ?? 0),
        of: Number(history?.reachedAdvised ?? 0),
        medianDays: numberOrNull(history?.daysToWinAdvised),
      },
    ]

    const stages = measured.map(({ stage, open, won, of, medianDays }) => {
      const winRateBps = rateBps(won, of)
      return {
        stage,
        open,
        winRateBps,
        /** How long a winning deal takes from this stage. Context for the
         *  reader rather than an input: it says whether the open book has any
         *  chance of turning over inside the days that are left. */
        medianDays: medianDays === null ? null : Math.round(medianDays),
        /** Kept as a fraction of a deal rather than rounded here: three
         *  roundings that each lose half a deal add up to a deal and a half
         *  the branch never had. The sum is rounded once, below. */
        worth: (open * winRateBps) / BPS_PER_UNIT,
      }
    })

    /** The trailing year's pace, over the days that are left. A second rate
     *  rather than a second way of counting the pipeline — see the note above
     *  this method for why that distinction is the whole design. */
    const windowDays = Math.max(1, daysBetween(yearBefore(to), to))
    const fromHistory =
      Number(landed?.won ?? 0) +
      Math.round((Number(history?.won ?? 0) * remaining) / windowDays)

    /** The target moves as leads arrive, so it is projected on the same clock
     *  as the wins. Comparing a whole period's forecast against the target for
     *  the fortnight that has happened so far would flatter every report. */
    const leadsToDate = Number(intake?.leads ?? 0)
    const leadsProjected =
      elapsed > 0 ? Math.round((leadsToDate * days) / elapsed) : leadsToDate
    const crBps = await this.crTarget(user)

    const low = Math.min(fromHistory, fromRunRate)
    const high = Math.max(fromHistory, fromRunRate)

    return {
      period: { from: query.from, to: query.to, days, elapsed, remaining },
      landed: {
        won: Number(landed?.won ?? 0),
        lost: Number(landed?.lost ?? 0),
        value: Number(landed?.value ?? 0),
      },
      pipeline: {
        open: stages.reduce((sum, s) => sum + s.open, 0),
        value: Number(pipeline?.value ?? 0),
        /** What the open book is worth eventually — not this period. Kept
         *  beside the forecast because it is the other half of the picture: a
         *  branch can be on pace and still be emptying its pipeline. */
        worth: Math.round(stages.reduce((sum, stage) => sum + stage.worth, 0)),
        stages: stages.map(({ stage, open, winRateBps, medianDays }) => ({
          stage,
          open,
          winRateBps,
          medianDays,
        })),
      },
      expected: { fromRunRate, fromHistory, low, high },
      target: {
        crBps,
        leadsToDate,
        leadsProjected,
        wonToDate: dealsToTarget(leadsToDate, crBps, 0),
        wonProjected: dealsToTarget(leadsProjected, crBps, 0),
      },
      gap: {
        /** What is missing right now, against what the period has asked for so
         *  far. The other two are what would still be missing at the end if
         *  the period lands at each end of the range. */
        today: dealsToTarget(leadsToDate, crBps, Number(landed?.won ?? 0)),
        best: dealsToTarget(leadsProjected, crBps, high),
        worst: dealsToTarget(leadsProjected, crBps, low),
      },
      /** How much history the rates above were measured from. A screen that
       *  draws a confident forecast off three closed deals is lying with a
       *  straight face, and only this number can tell it not to. */
      basis: { closedDeals: Number(history?.closed ?? 0), months: 12 },
    }
  }

  /** The open leads worth a manager's own time, biggest first.
   *
   *  The brief asks a branch manager which 20% of opportunities need them
   *  personally. This is that list, and the two decisions in it are worth
   *  stating.
   *
   *  **What qualifies.** Overdue, or silent for longer than the branch
   *  tolerates — both from `lib/lead-sql`, so this card, the team lead's
   *  queues and the lists behind them cannot drift apart. Never-contacted is
   *  deliberately *not* a trigger on its own: a lead raised this morning has
   *  not been contacted either, and a list that opens with today's intake is
   *  a list a manager stops reading. A lead nobody called for a week is
   *  already stale, because `LAST_TOUCH` falls back to the day it arrived.
   *
   *  **Ordered by value, not by lateness.** A team lead chases the oldest; a
   *  branch manager has time for a handful of deals a week and should spend
   *  it on the ones that move the number. The share of stuck value this list
   *  actually covers comes back with it, so the screen can say "these ten are
   *  62% of what is stuck" rather than implying they are all of it. */
  async attention(user: User, query: ReportQuery, limit = 10) {
    const slice = this.slice(user, query)
    const owner = alias(users, 'owner')
    const open = and(...slice, eq(opportunities.outcome, 'open'))
    const stuck = and(open, sql`((${IS_OVERDUE}) or (${IS_STALE}))`)

    const [rows, [totals], [everything]] = await Promise.all([
      this.db
        .select({
          id: opportunities.id,
          code: opportunities.code,
          customerName: customers.name,
          ownerId: opportunities.ownerId,
          ownerName: owner.name,
          segment: opportunities.segment,
          product: opportunities.product,
          value: opportunities.value,
          stage: opportunities.stage,
          dueDate: opportunities.dueDate,
          blockerCode: opportunities.blockerCode,
          lastTouchAt: sql<Date>`${LAST_TOUCH}`.mapWith(opportunities.createdAt),
          /** Why this row is here, decided by the database rather than
           *  re-derived on the screen from dates it would have to compare
           *  against a clock in another timezone. */
          overdue: sql<boolean>`(${IS_OVERDUE})`,
          stale: sql<boolean>`(${IS_STALE})`,
          untouched: sql<boolean>`(${IS_UNTOUCHED})`,
        })
        .from(opportunities)
        .innerJoin(customers, eq(customers.id, opportunities.customerId))
        .innerJoin(owner, eq(owner.id, opportunities.ownerId))
        .where(stuck)
        .orderBy(sql`${opportunities.value} desc`, sql`${LAST_TOUCH} asc`)
        .limit(limit),

      this.db
        .select({
          total: count(),
          value: sql<number>`coalesce(sum(${opportunities.value}), 0)`.mapWith(Number),
        })
        .from(opportunities)
        .where(stuck),

      this.db
        .select({
          total: count(),
          value: sql<number>`coalesce(sum(${opportunities.value}), 0)`.mapWith(Number),
        })
        .from(opportunities)
        .where(open),
    ])

    const stuckValue = Number(totals?.value ?? 0)
    const shown = rows.reduce((sum, row) => sum + Number(row.value), 0)

    return {
      /** Everything that qualifies, not just what fits on the card. */
      total: Number(totals?.total ?? 0),
      value: stuckValue,
      /** How much of the branch's whole open book is in this state. */
      shareBps: rateBps(stuckValue, Number(everything?.value ?? 0)),
      openTotal: Number(everything?.total ?? 0),
      /** What the rows below add up to, as a share of everything stuck — so
       *  the card can say how much of the problem it is showing. */
      shownValue: shown,
      shownShareBps: rateBps(shown, stuckValue),
      rows: rows.map((row) => ({
        ...row,
        value: Number(row.value),
        reasons: [
          row.overdue ? ('overdue' as const) : null,
          row.stale ? ('stale' as const) : null,
          row.untouched ? ('untouched' as const) : null,
        ].filter((reason): reason is 'overdue' | 'stale' | 'untouched' => reason !== null),
      })),
    }
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

  /** Who and what, without the dates.
   *
   *  `scope` bolts `from`/`to` onto `createdAt`, which is right for a report
   *  about what a month brought in and wrong for a forecast, where three
   *  different questions each want the window on a different column — closed
   *  in the period, raised in the period, open regardless. */
  private slice(user: User, query: ReportQuery): SQL[] {
    const parts: (SQL | undefined)[] = [opportunityScope(this.db, user)]
    if (query.segment) parts.push(eq(opportunities.segment, query.segment))
    if (query.ownerId) parts.push(eq(opportunities.ownerId, query.ownerId))
    return parts.filter((part): part is SQL => part !== undefined)
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

/** The three queues a team lead works from, counted from the shared
 *  definitions in `lib/lead-sql` so the dashboard, the lists behind it and the
 *  branch manager's intervention card can never disagree about what "quá hạn"
 *  means. */
const QUEUE_COUNTS = {
  open: sql<number>`count(*) filter (where ${opportunities.outcome} = 'open')`,
  overdue: sql<number>`count(*) filter (where ${IS_OVERDUE})`,
  stale: sql<number>`count(*) filter (where ${IS_STALE})`,
  untouched: sql<number>`count(*) filter (where ${IS_UNTOUCHED})`,
}

/** The three places an open lead can be standing, disjoint by construction —
 *  the same split `funnel` draws its ring from, named once so the forecast and
 *  the ring can never disagree about what "đã tư vấn" counts. */
const STAGE_COUNTS = {
  openNew: sql<number>`count(*) filter (where ${opportunities.contactedAt} is null)`,
  openContacted: sql<number>`count(*) filter (
    where ${opportunities.contactedAt} is not null and ${opportunities.advisedAt} is null
  )`,
  openAdvised: sql<number>`count(*) filter (where ${opportunities.advisedAt} is not null)`,
}

/** A date range's upper end is the day after, exclusive: `to=2026-09-20` has
 *  to include everything that happened on the twentieth. */
function endOf(day: string): Date {
  const date = new Date(day)
  date.setDate(date.getDate() + 1)
  return date
}

/** `percentile_cont` comes back as a string from the driver when it is not
 *  null, and as null on an empty set. Both have to be told apart from a real
 *  zero, which is why this is not a `Number(x) || null`. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function yearBefore(date: Date): Date {
  const start = new Date(date)
  start.setFullYear(start.getFullYear() - 1)
  return start
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/** Today, on the same grid the range endpoints are parsed onto.
 *
 *  Two mistakes at once, and they pull in opposite directions. Reading the UTC
 *  date gives yesterday for the first seven hours of every day at UTC+7, so
 *  the date parts have to come from local time — the same care `today` takes
 *  in the assistant's toolset. But `new Date('2026-09-01')` is UTC midnight,
 *  and subtracting a *local* midnight from it leaves the answer seven hours
 *  short of a whole number of days, which `daysBetween` then rounds one way in
 *  Hanoi and the other in Lisbon.
 *
 *  So: the date the person sees, placed at UTC midnight. Both ends of every
 *  subtraction then sit on the same grid and the day count is exact. */
function startOfToday(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

