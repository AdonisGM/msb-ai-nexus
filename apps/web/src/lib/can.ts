import type { Me } from '~/api/auth'

/** What each role is allowed to press, mirroring the server.
 *
 *  Hiding a button is a courtesy, never a control — `RolesGuard` and the
 *  funnel's `permits()` decide, and they refuse whatever the screen does. This
 *  exists so a person is not shown a control that will fail: a button that
 *  returns 403 to somebody who did nothing wrong is worse than no button.
 *
 *  Kept in one file rather than as a `role === 'bm'` check spread across the
 *  screens, so the next screen that grows a form has one place to ask. */

/** The branch manager reads figures and never touches a record.
 *
 *  Not a simplification of the rule — it *is* the rule the business gave:
 *  a deal is the salesperson's from first call to close, the team lead signs
 *  off against the paperwork, and the manager reads what came out. Every write
 *  endpoint on the server refuses them (`@Roles('sale', 'team_lead')`, and the
 *  funnel actions need `isOwner` or `managesOwner`), so showing them a form
 *  would only produce a 403 at the end of it.
 *
 *  The admin passes every role gate on the server — a technical account that
 *  still lands in the audit trail — so it keeps the buttons. */
export function canEditRecords(role: Me['role']): boolean {
  return role !== 'bm'
}
