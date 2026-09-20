import { and, eq, inArray, or, type SQL } from 'drizzle-orm'
import type { Db } from '../db/db.module'
import { SALES_ROLES, customers, opportunities, users, type User } from '../db/schema'

/** Row-level scoping: which records a person is allowed to see at all.
 *
 *  Kept apart from RolesGuard on purpose. The guard answers "may a team lead
 *  open this screen"; this answers "whose rows come back once they have". They
 *  fail differently too — a guard failure is a 403, a scope failure is simply
 *  an empty list, because telling someone a record exists but is not theirs is
 *  already a leak.
 *
 *  Everything funnels through one file so the rule has a single owner. Scoping
 *  spread across services is how a peer's customers eventually show up on the
 *  wrong screen: not because anyone wrote it wrongly, but because the eleventh
 *  query forgot to write it at all. */

/** Whose records a person may reach, expressed as a condition on `users`.
 *
 *  `undefined` means no restriction, which only an admin gets. Returning
 *  `undefined` rather than a tautology keeps the generated SQL clean and makes
 *  "unrestricted" impossible to produce by accident. */
function ownerFilter(user: User): SQL | undefined {
  switch (user.role) {
    /** Technical account. Sees everything, and every action is logged. */
    case 'admin':
      return undefined

    /** The whole unit, sales line only — an admin sitting in the same unit
     *  would otherwise turn up in the branch manager's headcount. */
    case 'bm':
      return and(eq(users.unitId, user.unitId), inArray(users.role, [...SALES_ROLES]))

    /** Their own people, plus themselves: a team lead may hold accounts.
     *  Notably NOT a peer's people — vertical, never horizontal. */
    case 'team_lead':
      return or(eq(users.id, user.id), eq(users.managerId, user.id))

    /** Only their own. */
    default:
      return eq(users.id, user.id)
  }
}

/** Whether this person may put a record in someone's name.
 *
 *  Assigning is bounded by the same tree as reading: a team lead may hand a
 *  customer to one of their own people, never to a peer's. Without this, the
 *  scope on the way out is decorative — anyone could push a row into a
 *  colleague's book and it would simply vanish from their own screen. */
export async function canAssignTo(db: Db, actor: User, ownerId: string): Promise<boolean> {
  const filter = ownerFilter(actor)
  const where = filter ? and(eq(users.id, ownerId), filter) : eq(users.id, ownerId)

  const [found] = await db.select({ id: users.id }).from(users).where(where).limit(1)
  return Boolean(found)
}

/** Customers this person may see. */
export function customerScope(db: Db, user: User): SQL | undefined {
  const filter = ownerFilter(user)
  if (!filter) return undefined
  return inArray(
    customers.ownerId,
    db.select({ id: users.id }).from(users).where(filter),
  )
}

/** Leads this person may see.
 *
 *  Ownership is the whole rule. There used to be a second gate here, hiding a
 *  salesperson's work from their team lead until it had been submitted — which
 *  made sense for a chain of approvals and makes none for this. A team lead's
 *  job is to notice the lead nobody has called yet; a scope that hid untouched
 *  leads from them would hide precisely the rows they exist to chase. */
export function opportunityScope(db: Db, user: User): SQL | undefined {
  const filter = ownerFilter(user)
  if (!filter) return undefined

  return inArray(
    opportunities.ownerId,
    db.select({ id: users.id }).from(users).where(filter),
  )
}
