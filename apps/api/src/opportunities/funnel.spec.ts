import { describe, expect, it } from 'vitest'
import type { Outcome, Role, Stage } from '../db/schema'
import {
  ACTIONS,
  actionsFor,
  allows,
  findAction,
  fits,
  outcomeOf,
  permits,
  type ActionName,
  type LeadState,
  type Relation,
} from './funnel'

/** No database here on purpose. These are the rules of the system stated as
 *  data, and a test that has to build a branch to ask "may a salesperson sign
 *  off their own win" is a test whose answer is buried in setup. */

function lead(over: Partial<LeadState> = {}): LeadState {
  return { stage: 'new', outcome: 'open', confirmed: false, ...over }
}

const owner: Relation = { role: 'sale', isOwner: true, managesOwner: false }
const peer: Relation = { role: 'sale', isOwner: false, managesOwner: false }
const manager: Relation = { role: 'team_lead', isOwner: false, managesOwner: true }
const otherLead: Relation = { role: 'team_lead', isOwner: false, managesOwner: false }
const bm: Relation = { role: 'bm', isOwner: false, managesOwner: false }
const admin: Relation = { role: 'admin', isOwner: false, managesOwner: false }

function names(relation: Relation, state: LeadState): ActionName[] {
  return actionsFor(relation, state).map((offered) => offered.action)
}

describe('the table itself', () => {
  it('offers every action exactly once', () => {
    const seen = ACTIONS.map((action) => action.action)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('finds an action by name and nothing by a name that is not one', () => {
    expect(findAction('win')?.action).toBe('win')
    expect(findAction('escalate')).toBeUndefined()
  })

  /** Every move that changes a figure the branch reports has to say why. The
   *  two that do not are the ones that only move a lead along the funnel. */
  it('demands a reason for everything that changes what is reported', () => {
    const demanding = ACTIONS.filter((action) => action.requiresReason).map((a) => a.action)
    expect(demanding.sort()).toEqual(['lose', 'reopen', 'win'])
  })
})

describe('what a salesperson can do with their own lead', () => {
  it('walks it down the funnel one step at a time', () => {
    expect(names(owner, lead({ stage: 'new' }))).toEqual(['contact'])
    expect(names(owner, lead({ stage: 'contacted' }))).toEqual(['advise', 'win', 'lose'])
    expect(names(owner, lead({ stage: 'advised' }))).toEqual(['win', 'lose'])
  })

  /** A lead nobody has rung cannot have been sold. Allowing it is the fastest
   *  route to a conversion rate that means nothing. */
  it('cannot record a result on a lead nobody has called', () => {
    expect(names(owner, lead({ stage: 'new' }))).not.toContain('win')
    expect(names(owner, lead({ stage: 'new' }))).not.toContain('lose')
  })

  it('can land a deal straight off the first call, without advising', () => {
    expect(names(owner, lead({ stage: 'contacted' }))).toContain('win')
  })

  it('has nothing left to press once it has landed', () => {
    expect(names(owner, lead({ stage: 'advised', outcome: 'won' }))).toEqual([])
    expect(names(owner, lead({ stage: 'advised', outcome: 'lost' }))).toEqual([])
  })

  /** The whole point of the rebuild: a win is counted the moment the person
   *  who made it records it. Nothing is submitted and nobody approves it. */
  it('needs nobody to sign anything for the win to stand', () => {
    const state = lead({ stage: 'advised' })
    expect(allows(findAction('win')!, owner, state)).toBe(true)
  })
})

describe("what a salesperson cannot do with somebody else's lead", () => {
  it('cannot touch the funnel of a lead that is not theirs', () => {
    expect(names(peer, lead({ stage: 'contacted' }))).toEqual([])
  })

  it('cannot sign off anything, their own work included', () => {
    const landed = lead({ stage: 'advised', outcome: 'won' })
    expect(names(owner, landed)).not.toContain('confirm')
    expect(names(peer, landed)).not.toContain('confirm')
  })
})

describe('what a team lead can do', () => {
  const landed = lead({ stage: 'advised', outcome: 'won' })

  it("signs off and reopens their own people's closed leads, and nothing else", () => {
    expect(names(manager, landed).sort()).toEqual(['confirm', 'reopen'])
  })

  it('has nothing to do with a lead still being worked', () => {
    expect(names(manager, lead({ stage: 'contacted' }))).toEqual([])
  })

  it("cannot reach into another team lead's people", () => {
    expect(names(otherLead, landed)).toEqual([])
  })

  /** A second pair of eyes has to belong to a second person. A team lead who
   *  holds accounts of their own signs like anyone else: not their own. */
  it('cannot sign off a lead they hold themselves', () => {
    const holdsIt: Relation = { role: 'team_lead', isOwner: true, managesOwner: false }
    expect(names(holdsIt, landed)).not.toContain('confirm')
  })

  it('stops offering the signature once it has been given', () => {
    expect(names(manager, { ...landed, confirmed: true })).toEqual([])
  })

  /** Reopening a signed-off lead would quietly withdraw a figure somebody put
   *  their name to. */
  it('will not reopen a lead it has already signed', () => {
    expect(names(manager, { ...landed, confirmed: true })).not.toContain('reopen')
  })

  it('signs off a loss as readily as a win, which is the point', () => {
    const lost = lead({ stage: 'contacted', outcome: 'lost' })
    expect(names(manager, lost)).toContain('confirm')
  })
})

describe('what a branch manager can do', () => {
  /** Nothing. The branch manager reads numbers; every figure on their screen
   *  was put there by somebody else, and there is no deal-level button that
   *  belongs to them. */
  it('presses nothing on any lead in any state', () => {
    const states: LeadState[] = [
      lead(),
      lead({ stage: 'contacted' }),
      lead({ stage: 'advised' }),
      lead({ stage: 'advised', outcome: 'won' }),
      lead({ stage: 'advised', outcome: 'lost', confirmed: true }),
    ]
    for (const state of states) expect(names(bm, state)).toEqual([])
  })
})

describe('the admin account', () => {
  /** A technical account that can unstick a demo. Every action still lands in
   *  the trail under its own name. */
  it('passes the permission test on everything', () => {
    for (const action of ACTIONS) expect(permits(action, admin)).toBe(true)
  })

  /** Passing the permission test is not passing the state test. An admin can
   *  press what a person could have pressed, not what nobody could. */
  it('still cannot press what the lead has no room for', () => {
    expect(names(admin, lead({ stage: 'new' }))).toEqual(['contact'])
    expect(fits(findAction('win')!, lead({ stage: 'new' }))).toBe(false)
  })
})

describe('where a lead lands after each move', () => {
  const cases: Array<[ActionName, LeadState, Stage, Outcome]> = [
    ['contact', lead({ stage: 'new' }), 'contacted', 'open'],
    ['advise', lead({ stage: 'contacted' }), 'advised', 'open'],
    ['win', lead({ stage: 'contacted' }), 'contacted', 'won'],
    ['win', lead({ stage: 'advised' }), 'advised', 'won'],
    ['lose', lead({ stage: 'advised' }), 'advised', 'lost'],
    ['confirm', lead({ stage: 'advised', outcome: 'won' }), 'advised', 'won'],
  ]

  it.each(cases)('%s leaves it at %s / %s', (action, state, stage, outcome) => {
    expect(outcomeOf(action, state)).toEqual({ stage, outcome })
  })

  /** Reopening puts the lead back where the conversation had got to, not back
   *  to the top: the calls already made still happened, and resetting them
   *  would inflate every "time to first contact" figure in the branch. */
  it('reopens a lead where the conversation left off', () => {
    expect(outcomeOf('reopen', lead({ stage: 'advised', outcome: 'lost' }))).toEqual({
      stage: 'advised',
      outcome: 'open',
    })
  })

  it('never moves the funnel backwards', () => {
    const order: Record<Stage, number> = { new: 0, contacted: 1, advised: 2 }
    for (const action of ACTIONS) {
      for (const stage of action.from) {
        const state = lead({ stage, outcome: action.needs === 'closed' ? 'won' : 'open' })
        expect(order[outcomeOf(action.action, state).stage]).toBeGreaterThanOrEqual(order[stage])
      }
    }
  })
})

describe('every role against every state', () => {
  /** A sweep rather than a list of cases: it catches a rule added later that
   *  quietly hands somebody a button the design never meant them to have. */
  it('lets nobody but the owner or their manager press anything', () => {
    const stages: Stage[] = ['new', 'contacted', 'advised']
    const outcomes: Outcome[] = ['open', 'won', 'lost']
    const strangers: Relation[] = [peer, otherLead, bm]

    for (const role of ['sale', 'team_lead', 'bm'] as Role[]) {
      void role
      for (const stage of stages) {
        for (const outcome of outcomes) {
          for (const confirmed of [false, true]) {
            const state = lead({ stage, outcome, confirmed })
            for (const stranger of strangers) {
              expect(names(stranger, state)).toEqual([])
            }
          }
        }
      }
    }
  })

  it('never offers a funnel move on a lead that has already landed', () => {
    const moves: ActionName[] = ['contact', 'advise', 'win', 'lose']
    for (const outcome of ['won', 'lost'] as Outcome[]) {
      for (const stage of ['new', 'contacted', 'advised'] as Stage[]) {
        const offered = names(admin, lead({ stage, outcome }))
        for (const move of moves) expect(offered).not.toContain(move)
      }
    }
  })
})
