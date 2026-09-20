import type { Outcome, Role, Stage } from '../db/schema'

/** What can be done to a lead, in one table.
 *
 *  This replaces a ten-state approval chain that described a process nobody
 *  runs. A lead belongs to one salesperson from the day it arrives; they walk
 *  it down the funnel and they decide whether it landed. Nothing is submitted,
 *  nothing is approved, and the branch report counts a win the moment it is
 *  recorded.
 *
 *  What remains for a team lead is two moves, and they are deliberately the
 *  only two: reconciling a closed deal against the paperwork that lives
 *  outside this system, and putting back a deal that was closed by mistake.
 *
 *  Permission here is mostly about the deal, not the role. `owner` covers
 *  whoever holds the lead — usually a salesperson, sometimes a team lead with
 *  accounts of their own — and that is the right test, because the question is
 *  "is this yours to work" rather than "what is your job title". */

export type ActionName = 'contact' | 'advise' | 'win' | 'lose' | 'confirm' | 'reopen'

/** Who is asking, relative to the lead in front of them. */
export type Relation = {
  role: Role
  /** Holds the lead. */
  isOwner: boolean
  /** Is the owner's direct manager. Reconciling is a second pair of eyes, so
   *  it has to be someone else's. */
  managesOwner: boolean
}

/** As much of a lead as any rule here needs to see. */
export type LeadState = {
  stage: Stage
  outcome: Outcome
  confirmed: boolean
}

export type FunnelAction = {
  action: ActionName
  /** Stages it can be pressed from. */
  from: readonly Stage[]
  /** The outcome it needs: `open` for the moves that work a live lead,
   *  `closed` for the two that act on one already decided. */
  needs: 'open' | 'closed'
  by: 'owner' | 'manager'
  /** Anything that changes what the branch reports has to say why. */
  requiresReason?: boolean
  /** Refuses a lead a team lead has already signed off. Reopening one would
   *  quietly withdraw a figure someone put their name to. */
  refusesConfirmed?: boolean
}

const STAGES_ALL: readonly Stage[] = ['new', 'contacted', 'advised']
/** Winning or losing means a conversation happened. A lead nobody has called
 *  cannot have been sold, and letting it be marked won anyway is the fastest
 *  way to a conversion rate that means nothing. */
const STAGES_WORKED: readonly Stage[] = ['contacted', 'advised']

export const ACTIONS: readonly FunnelAction[] = [
  { action: 'contact', from: ['new'], needs: 'open', by: 'owner' },
  { action: 'advise', from: ['contacted'], needs: 'open', by: 'owner' },

  {
    action: 'win',
    from: STAGES_WORKED,
    needs: 'open',
    by: 'owner',
    requiresReason: true,
  },
  {
    action: 'lose',
    from: STAGES_WORKED,
    needs: 'open',
    by: 'owner',
    /** The reason is the point. A team lead reading a month of losses is how a
     *  branch finds out it is losing on rate rather than on service. */
    requiresReason: true,
  },

  /** The team lead's reconciliation. Changes no figure on any report — it
   *  records that a person has checked this row against the file. */
  { action: 'confirm', from: STAGES_ALL, needs: 'closed', by: 'manager' },

  {
    action: 'reopen',
    from: STAGES_ALL,
    needs: 'closed',
    by: 'manager',
    requiresReason: true,
    refusesConfirmed: true,
  },
]

export function findAction(action: string): FunnelAction | undefined {
  return ACTIONS.find((candidate) => candidate.action === action)
}

/** Whether the lead is in a state this action can be pressed from. Kept apart
 *  from the permission test so the service can tell the two failures apart:
 *  "this has moved on under you" is a different message from "this is not
 *  yours". */
export function fits(action: FunnelAction, state: LeadState): boolean {
  if (!action.from.includes(state.stage)) return false
  if (action.needs === 'open' && state.outcome !== 'open') return false
  if (action.needs === 'closed' && state.outcome === 'open') return false
  if (action.refusesConfirmed && state.confirmed) return false
  /** Signing twice is not an error worth a different message, but it is not a
   *  button either. */
  if (action.action === 'confirm' && state.confirmed) return false
  return true
}

/** Whether this person may press it.
 *
 *  An admin passes, because it is the technical account and someone has to be
 *  able to unstick a demo. Every action still lands in the trail under their
 *  own name. */
export function permits(action: FunnelAction, relation: Relation): boolean {
  if (relation.role === 'admin') return true
  if (action.by === 'owner') return relation.isOwner
  /** A team lead signs off their own people's work. Signing your own defeats
   *  the point of a second pair of eyes, so holding the lead disqualifies you
   *  however senior you are. */
  return relation.role === 'team_lead' && relation.managesOwner && !relation.isOwner
}

export function allows(action: FunnelAction, relation: Relation, state: LeadState): boolean {
  return permits(action, relation) && fits(action, state)
}

/** The buttons to offer, with what each one needs.
 *
 *  Returned to the screen rather than letting it work this out, so the rule
 *  about which moves demand a reason lives in one place. A screen that guessed
 *  would eventually guess wrong and post something the server rejects, and the
 *  person on the other end would see a form clear itself for no reason they
 *  could see. */
export type OfferedAction = { action: ActionName; requiresReason: boolean }

export function actionsFor(relation: Relation, state: LeadState): OfferedAction[] {
  return ACTIONS.filter((action) => allows(action, relation, state)).map((action) => ({
    action: action.action,
    requiresReason: action.requiresReason ?? false,
  }))
}

/** Where a lead lands after an action, as the columns the schema ties
 *  together. Returned rather than applied so the caller writes one patch. */
export function outcomeOf(action: ActionName, state: LeadState): {
  stage: Stage
  outcome: Outcome
} {
  switch (action) {
    case 'contact':
      return { stage: 'contacted', outcome: state.outcome }
    case 'advise':
      return { stage: 'advised', outcome: state.outcome }
    case 'win':
      return { stage: state.stage, outcome: 'won' }
    case 'lose':
      return { stage: state.stage, outcome: 'lost' }
    /** Reopening puts the lead back where the conversation had got to, not
     *  back to the top. The calls already made still happened. */
    case 'reopen':
      return { stage: state.stage, outcome: 'open' }
    case 'confirm':
      return { stage: state.stage, outcome: state.outcome }
  }
}

/** The trail entry an action writes. `edited` and `created` are written
 *  directly by the service; everything else maps one to one. */
export const AUDIT_KIND_OF: Record<ActionName, 'contacted' | 'advised' | 'won' | 'lost' | 'confirmed' | 'reopened'> = {
  contact: 'contacted',
  advise: 'advised',
  win: 'won',
  lose: 'lost',
  confirm: 'confirmed',
  reopen: 'reopened',
}
