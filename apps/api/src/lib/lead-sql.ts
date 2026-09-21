import { sql } from 'drizzle-orm'
import { opportunities } from '../db/schema'

/** The handful of expressions that decide what a queue means.
 *
 *  They lived in two files and were about to live in three. The comment on
 *  `LAST_TOUCH` said it out loud — "three copies of a `coalesce` is three
 *  chances for a list to disagree with the number printed on its own rows" —
 *  and then the reporting service quietly kept a fourth copy inside its own
 *  counts. So they are here, once, and both services import them.
 *
 *  Nothing in this file touches scope. Who may see a row is `opportunityScope`
 *  and stays there; this is only about what "quá hạn" and "im lặng" mean. */

/** When anything last happened to this lead.
 *
 *  The order matters: the advice is later than the call, and a lead nobody has
 *  touched falls back to the day it arrived, which is exactly how long it has
 *  been ignored. */
export const LAST_TOUCH = sql`coalesce(${opportunities.advisedAt}, ${opportunities.contactedAt}, ${opportunities.createdAt})`

/** A live lead nobody has touched for this long.
 *
 *  The design's number, not one the branch has agreed — which is why it is a
 *  named constant rather than a `7` written into four queries. The web repeats
 *  it for its captions; if the branch ever picks a different figure, these two
 *  are the places. */
export const STALE_DAYS = 7

/** Open, and past the date somebody promised. A closed lead is never overdue:
 *  once it is decided, the deadline stopped mattering. */
export const IS_OVERDUE = sql`${opportunities.outcome} = 'open'
  and ${opportunities.dueDate} is not null
  and ${opportunities.dueDate} < current_date`

/** Open and silent for longer than the branch tolerates. */
export const IS_STALE = sql`${opportunities.outcome} = 'open'
  and ${LAST_TOUCH} < now() - make_interval(days => ${STALE_DAYS})`

/** Open and never contacted at all — not the same as stale, and worse: stale
 *  means the conversation stopped, this means it never started. */
export const IS_UNTOUCHED = sql`${opportunities.outcome} = 'open'
  and ${opportunities.contactedAt} is null`
