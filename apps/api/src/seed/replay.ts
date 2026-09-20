import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/db.module'
import { auditEvents, opportunities } from '../db/schema'

const DAY = 24 * 60 * 60 * 1000

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY)
}

export function isoDate(days: number): string {
  return daysFromNow(days).toISOString().slice(0, 10)
}

/** The calendar a replayed lead is moved onto. Both seeds describe their
 *  timelines this way, which is why the backdating below is written once. */
export type Timeline = {
  openedDaysAgo: number
  contactedDaysAgo?: number
  advisedDaysAgo?: number
  closedDaysAgo?: number
  confirmedDaysAgo?: number
  outcome?: 'won' | 'lost'
}

/** Moves every trace back onto the calendar the seed describes.
 *
 *  Replaying a lead through the services takes milliseconds, so without this
 *  every step would be timed at a fraction of a second and "how long until
 *  somebody rang them" would be a column of zeroes. Real work takes days.
 *
 *  The times come from the seed rather than from a random spread at write
 *  time, so a lead that reads "opened 34 days ago, first called on day 31" is
 *  exactly that on screen — and `heldMs` is recomputed from the new
 *  timestamps, so the log and the row it describes can never disagree.
 *
 *  Only demo data is ever touched. */
export async function backdate(db: Db, timelines: Map<string, Timeline>) {
  for (const [id, deal] of timelines) {
    const at: Partial<Record<string, Date>> = {
      created: daysFromNow(-deal.openedDaysAgo),
      contacted: when(deal.contactedDaysAgo),
      advised: when(deal.advisedDaysAgo),
      won: deal.outcome === 'won' ? when(deal.closedDaysAgo) : undefined,
      lost: deal.outcome === 'lost' ? when(deal.closedDaysAgo) : undefined,
      confirmed: when(deal.confirmedDaysAgo),
    }

    const trace = await db
      .select({ id: auditEvents.id, kind: auditEvents.kind })
      .from(auditEvents)
      .where(eq(auditEvents.opportunityId, id))
      .orderBy(asc(auditEvents.seq))

    let previous: number | null = null

    for (const event of trace) {
      const stamp = at[event.kind] ?? daysFromNow(-deal.openedDaysAgo)

      await db
        .update(auditEvents)
        .set({
          createdAt: stamp,
          /** Null on the first event and only there — the schema ties the two
           *  together, so a gap here would be refused rather than silently
           *  bending every duration drawn from this column. */
          heldMs: previous === null ? null : Math.max(0, stamp.getTime() - previous),
        })
        .where(eq(auditEvents.id, event.id))

      previous = stamp.getTime()
    }

    /** The lead's own marks move with its trace. Leaving them at replay time
     *  would put "first contacted" minutes ago on a lead whose log says it was
     *  three weeks back, and every figure drawn off the marks would disagree
     *  with every figure drawn off the log. */
    await db
      .update(opportunities)
      .set({
        createdAt: at.created!,
        contactedAt: at.contacted ?? null,
        advisedAt: at.advised ?? null,
        closedAt: at.won ?? at.lost ?? null,
        confirmedAt: at.confirmed ?? null,
        updatedAt: new Date(previous ?? at.created!.getTime()),
      })
      .where(eq(opportunities.id, id))
  }
}

function when(daysAgo: number | undefined): Date | undefined {
  return daysAgo === undefined ? undefined : daysFromNow(-daysAgo)
}
