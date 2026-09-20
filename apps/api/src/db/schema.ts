import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/* ──────────────────────────────────────────────────────────────────────────
 * Units
 * ────────────────────────────────────────────────────────────────────────── */

/** Business unit. `parentId` points back at this table, so growing a region or
 *  area tier later is a matter of inserting rows, not changing the structure.
 *  The contest build only ever uses a single `branch` row. */
export const units = pgTable(
  'units',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    /** `branch` is the lowest tier and the only one the contest build populates. */
    kind: text('kind').notNull().default('branch'),
    parentId: text('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('set null'),
    check('units_kind', sql`${t.kind} in ('branch', 'region', 'area')`),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Users
 * ────────────────────────────────────────────────────────────────────────── */

/** Three concepts that are easy to conflate, kept apart because they serve
 *  three different jobs:
 *
 *    role   System permission. Four values, and the ONLY column authorization
 *           is allowed to read. Adding a job title never touches a guard.
 *    title  Job title shown on screen. Free text, HR can rename it any time.
 *    level  Career grade. Carries no permission at all; it exists so a team
 *           lead can compare two salespeople on the same grade, and so the
 *           "skill gap" view has something to stand on.
 *
 *  Collapsing the three into one column is the classic trap: the day someone
 *  adds a new grade, authorization has to change with it.
 *
 *  The management tree lives in `managerId`, not in `role`. That is why the
 *  contest build can give one team lead a single salesperson while a real
 *  rollout gives them eight to ten, with no code change. */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Login handle: SALE-SSE-01, TL-RB-01, BM-TH-01. */
    code: text('code').notNull().unique(),

    /** Staff number as HR issues it, and the join key for imported leads.
     *
     *  Deliberately not the login handle. A bulk upload of leads names the
     *  salesperson by staff number, which is what the source systems carry and
     *  what is printed on a payslip; the login handle is ours to rename and
     *  belongs to this application alone. Fusing them would mean an import
     *  silently failing to find anyone the day someone's handle changes. */
    employeeCode: text('employee_code').notNull().unique(),

    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),

    /** System permission. Four values, closed set. */
    role: text('role').notNull(),
    /** Job title, for display only. Free text. */
    title: text('title').notNull(),
    /** Career grade. Never read by authorization. */
    level: text('level'),

    /** Customer segment covered. A branch manager covers none, so it is null. */
    segment: text('segment'),

    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    /** Direct manager. The branch manager is the root, so it is null there. */
    managerId: text('manager_id'),

    joinedOn: date('joined_on'),
    /** Display order inside a team lead's roster. */
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.managerId], foreignColumns: [t.id] }).onDelete('set null'),

    index('users_manager').on(t.managerId),
    index('users_unit_role').on(t.unitId, t.role),

    check('users_role', sql`${t.role} in ('sale', 'team_lead', 'bm', 'admin')`),
    check('users_segment', sql`${t.segment} is null or ${t.segment} in ('sse', 'rb')`),
    check(
      'users_level',
      sql`${t.level} is null or ${t.level} in ('cv1', 'cv2', 'cv3', 'cvc', 'tn', 'gd')`,
    ),

    /** Salespeople and team leads belong to a segment; a branch manager covers
     *  the whole unit and an admin sits outside the sales line entirely.
     *  Without this the SSE pipeline and the retail pipeline blend together. */
    check(
      'users_segment_by_role',
      sql`${t.role} in ('bm', 'admin') or ${t.segment} is not null`,
    ),

    /** Everyone reports to someone except the branch manager at the root and
     *  the admin, who is not part of the tree. Without this an orphaned
     *  salesperson silently drops out of every report and nobody notices. */
    check(
      'users_manager_by_role',
      sql`${t.role} in ('bm', 'admin') or ${t.managerId} is not null`,
    ),

    /** An admin is a technical account, so it sits outside the sales line for
     *  good rather than by convention: no segment to be counted under, no
     *  manager to hang off. The two checks above only stop those fields being
     *  required — this one stops them being set at all. */
    check(
      'users_admin_outside_tree',
      sql`${t.role} <> 'admin' or (${t.segment} is null and ${t.managerId} is null)`,
    ),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Customers
 * ────────────────────────────────────────────────────────────────────────── */

/** A customer file. The bedrock of everything, and deliberately quiet: across
 *  the whole life of a deal this table changes about twice — when the customer
 *  is taken on, and when a product is finally sold. Everything that moves
 *  belongs in `signals` or `opportunities`.
 *
 *  It carries no approval status, so it needs no audit trail either. Only
 *  opportunities travel up the chain. */
export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    segment: text('segment').notNull(),

    /** The salesperson who holds this relationship. Row-level scoping reads
     *  this together with `users.manager_id`: a team lead sees their own
     *  people's customers, never a peer's. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),

    /** MSB products already in use. An array rather than a join table because
     *  nothing is ever queried by product in this build, and a join table
     *  would cost a migration and two screens for no gain. */
    currentProducts: text('current_products').array().notNull().default(sql`'{}'`),

    /** Turnover in whole đồng. `bigint` in Postgres, `mode: 'number'` in
     *  TypeScript: the values sit far inside what a double holds exactly,
     *  while a real BigInt would refuse to serialize to JSON on the way out.
     *  Arithmetic on any amount goes through lib/money.ts, never raw floats. */
    revenue: bigint('revenue', { mode: 'number' }),

    /** Where the relationship stands with MSB, free text for now. */
    relationStage: text('relation_stage'),

    /** Fields that differ by segment — cash-flow share moving to another bank
     *  for SSE, repayment source and collateral for retail. They live here
     *  rather than as columns because half of them would be null for half the
     *  rows, and because the sales team can add one without a migration.
     *
     *  The rule for choosing: anything filtered, summed or shown in a list
     *  column gets a real column; anything read only on the detail screen
     *  goes in here. */
    attributes: jsonb('attributes').notNull().default(sql`'{}'::jsonb`),

    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customers_owner').on(t.ownerId),
    index('customers_segment').on(t.segment),
    check('customers_segment', sql`${t.segment} in ('sse', 'rb')`),
    check('customers_revenue', sql`${t.revenue} is null or ${t.revenue} >= 0`),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Signals
 * ────────────────────────────────────────────────────────────────────────── */

/** What was just observed about a customer: cash moving to another bank, a
 *  rate being compared, a deadline appearing. Where `customers` holds traits
 *  that barely change, this holds events that do.
 *
 *  It is the model's raw material. Generating a draft reads the customer for
 *  context and the signals for what has actually been happening; without this
 *  table the model only ever sees a static file.
 *
 *  Append-only. A signal that turns out to be wrong is corrected by writing a
 *  newer one over the top, never by editing or deleting: the mistaken reading
 *  is itself evidence, and it feeds the recurring-blocker view the branch
 *  manager works from.
 *
 *  Signals hang off the customer, not off a deal, because one observation can
 *  feed several — "cash moving to another bank" is both a current-account
 *  opportunity and a working-capital one. */
export const signals = pgTable(
  'signals',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    type: text('type').notNull(),
    /** The observation itself, one sentence. */
    content: text('content').notNull(),
    source: text('source').notNull().default('sale'),

    /** When it was observed, which is not when it was typed up. A meeting on
     *  Friday entered on Monday has to sort by the Friday. */
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),

    /** Null when the system or the model wrote the row. */
    authorId: text('author_id').references(() => users.id),

    /** The salesperson's own sentence, kept verbatim.
     *
     *  This is the evidence behind "the model proposes, a person confirms":
     *  it can be put side by side with what the model inferred from it. Also
     *  the honest record if the model reads a sentence wrongly. */
    rawNote: text('raw_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The customer timeline, newest first — the one query this table serves. */
    index('signals_customer_observed').on(t.customerId, t.observedAt),
    check(
      'signals_type',
      sql`${t.type} in ('cash_flow', 'product_gap', 'need', 'competition', 'deadline', 'documents', 'other')`,
    ),
    check('signals_source', sql`${t.source} in ('sale', 'system', 'ai')`),
    /** A signal written by a person has to say who. Only the system and the
     *  model are allowed to be anonymous. */
    check(
      'signals_author_by_source',
      sql`${t.source} <> 'sale' or ${t.authorId} is not null`,
    ),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Opportunities
 * ────────────────────────────────────────────────────────────────────────── */

/** A lead: one customer, one product, one need. The unit of work for everyone
 *  in the branch, and the row every figure on every report counts.
 *
 *  One customer can carry several at once — a card and an overdraft are two
 *  leads on one file — which is why conversion counts rows here and never
 *  counts people.
 *
 *  Three things run through this table and must not be collapsed into one
 *  chain, which is exactly the mistake this schema was rebuilt to undo:
 *
 *    stage        how far the salesperson has got with the customer:
 *                 new → contacted → advised. Theirs alone; nobody approves it.
 *    outcome      open / won / lost. The salesperson decides, and the branch
 *                 report counts it the moment they do — no signature gates it.
 *    confirmedAt  a team lead has sat down with the paperwork that lives
 *                 outside this system and checked the row against it.
 *
 *  The third runs beside the other two rather than in front of them. It
 *  answers "does the database agree with the filing cabinet", which is a
 *  different question from "did we win", and blocking one on the other was
 *  what made the old ten-state chain wrong. */
export const opportunities = pgTable(
  'opportunities',
  {
    id: text('id').primaryKey(),
    /** Human-facing reference, OPP-2026-0001. People say it out loud. */
    code: text('code').notNull().unique(),

    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),

    /** Copied from the customer rather than joined. Every funnel, gap and
     *  conversion query filters on it, and the branch manager's screen compares
     *  the two segments side by side; paying for a join on the hottest query
     *  in the app to avoid a column that changes almost never is a bad trade.
     *  Whatever moves a customer between segments has to update this too. */
    segment: text('segment').notNull(),

    /** The branch that did this work, fixed at the moment the lead was raised.
     *
     *  Not derived from whoever owns it today, and that is the whole point.
     *  Without this column a branch's figures are "whatever the people who
     *  currently sit here happen to have done, wherever they did it" — so a
     *  salesperson transferring in October would silently carry every deal
     *  they closed in September out of one branch's report and into another's,
     *  and re-running September would print a different number than it did in
     *  September. A report about a period has to stay true about that period.
     *
     *  It follows that a transfer is a data question, not a button: moving
     *  somebody sets their new unit, and their finished work stays counted
     *  where it was done. */
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),

    /** What is being sold, as a code from the closed set. Free text here would
     *  have killed the branch report, whose whole shape is one column per
     *  product — cards, overdrafts and unsecured loans counted separately. */
    product: text('product').notNull(),
    need: text('need').notNull(),
    /** Expected size in whole đồng, entered up front. What was actually sold
     *  lands in `opportunity_products`, which is a different number and often
     *  more than one of them. Arithmetic goes through lib/money.ts. */
    value: bigint('value', { mode: 'number' }).notNull(),

    /** Where the salesperson has got to. Three steps, matching the funnel the
     *  branch already reports on. */
    stage: text('stage').notNull().default('new'),

    /** When each step happened.
     *
     *  These carry the funnel rather than `stage` alone, because the report
     *  asks "how many have been contacted" of every row including the closed
     *  ones, and a won deal's stage has stopped moving. Counting
     *  `contacted_at is not null` is exact; comparing an ordinal stage means
     *  deciding whether `won` sorts above `advised`, which is a question the
     *  funnel should never have to ask.
     *
     *  They also hand the model the one thing it needs to be useful about a
     *  list of three hundred names: how long each has been sitting untouched. */
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    advisedAt: timestamp('advised_at', { withTimezone: true }),

    /** What a person has checked and stands behind. */
    confirmedData: jsonb('confirmed_data').notNull().default(sql`'{}'::jsonb`),
    /** What the model inferred and nobody has confirmed yet.
     *
     *  Two columns, never one. This separation is the whole argument of the
     *  entry — the model proposes, a person confirms — and the screen shows
     *  them in two different colours. Merging them loses the point and loses
     *  the answer to "how do you keep a human in control". */
    aiHypothesis: jsonb('ai_hypothesis').notNull().default(sql`'{}'::jsonb`),
    /** What is still unknown. Also what a team lead sends a deal back for. */
    missingInfo: text('missing_info').array().notNull().default(sql`'{}'`),

    /** Why the deal is stuck, as a code so identical blockers group together.
     *
     *  Free text here would have killed the branch manager's best screen: the
     *  point is to see that eleven deals worth 47 billion are all stuck on
     *  the same thing, which is a process problem, not eleven people's
     *  problem. `select blocker_code, count(*), sum(value) ... group by 1`
     *  only works if the values are a closed set. */
    blockerCode: text('blocker_code'),
    /** The specifics in the salesperson's own words. */
    blockerNote: text('blocker_note'),

    /** What this person means to do next, in their own words. Paired with
     *  `dueDate`, it is the whole of the model's work-management job: a lead
     *  promised a call back today, and a lead nobody has touched in a week. */
    nextAction: text('next_action'),

    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    /** A date, not a timestamp: a bank deadline is a day, and comparing days
     *  keeps "overdue" from flipping with the clock. */
    dueDate: date('due_date'),

    outcome: text('outcome').notNull().default('open'),
    outcomeReason: text('outcome_reason'),

    /** Where the lead came in from. A bulk upload matches a salesperson by
     *  staff number; a salesperson who found the customer themselves types it
     *  in. Both end up here, and the branch report counts them together — but
     *  conversion on bought leads and conversion on self-sourced ones are
     *  different numbers, and separating them later needs this column now. */
    source: text('source').notNull().default('manual'),

    /** Typed by a person or drafted by the model. This one column is the
     *  before/after axis of the whole trial: the same system, measured twice. */
    createdVia: text('created_via').notNull().default('manual'),

    /** The team lead's reconciliation mark.
     *
     *  Set when a team lead has compared this row against the paperwork that
     *  lives outside the system and found it complete. It changes no figure on
     *  any report — the deal was already counted the moment the salesperson
     *  closed it — so this is not an approval and must never be read as a gate.
     *  What it buys is the answer to a question a dashboard cannot answer on
     *  its own: of the deals we are reporting, how many has a human actually
     *  checked against the file. */
    confirmedById: text('confirmed_by_id').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** What the team lead found — a missing document, a figure that differed.
     *  Recorded rather than acted on: correcting the row is the salesperson's
     *  job, and overwriting their work silently is how two people stop
     *  agreeing about what happened. */
    confirmNote: text('confirm_note'),

    /** When the model drafted this, if it did. Pairs with `createdVia` to
     *  measure what the model saves a salesperson. */
    draftedAt: timestamp('drafted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('opportunities_customer').on(t.customerId),
    /** A salesperson's own working list, which is the busiest query here. */
    index('opportunities_owner_stage').on(t.ownerId, t.stage),
    /** The branch report, which is the one query the whole BM screen is. */
    index('opportunities_unit_outcome').on(t.unitId, t.outcome),
    /** The funnel and the conversion rate, per segment. */
    index('opportunities_segment_outcome').on(t.segment, t.outcome),
    index('opportunities_due').on(t.dueDate),
    /** A team lead's signing queue: closed, not yet reconciled. Partial, so it
     *  indexes only the handful of rows actually waiting. */
    index('opportunities_unconfirmed')
      .on(t.ownerId, t.closedAt)
      .where(sql`${t.outcome} <> 'open' and ${t.confirmedAt} is null`),
    /** Recurring blockers, which is what a team lead chases people about. */
    index('opportunities_blocker').on(t.blockerCode),

    check('opportunities_segment', sql`${t.segment} in ('sse', 'rb')`),
    check('opportunities_value', sql`${t.value} > 0`),
    check(
      'opportunities_stage',
      sql`${t.stage} in ('new', 'contacted', 'advised')`,
    ),
    check(
      'opportunities_product',
      sql`${t.product} in ('card', 'od', 'usl', 'loan', 'casa', 'insurance', 'other')`,
    ),
    check('opportunities_outcome', sql`${t.outcome} in ('open', 'won', 'lost')`),
    check('opportunities_source', sql`${t.source} in ('import', 'manual')`),
    check('opportunities_created_via', sql`${t.createdVia} in ('manual', 'ai')`),
    check(
      'opportunities_blocker_code',
      sql`${t.blockerCode} is null or ${t.blockerCode} in ('rate', 'speed', 'experience', 'documents', 'collateral', 'policy', 'competitor', 'customer_hesitation', 'other')`,
    ),

    /** The stage and its two marks are one fact written twice, so they are
     *  locked together rather than left to agree by convention. A row claiming
     *  `advised` with no `advised_at` would be counted by the stage column on
     *  one screen and missed by the funnel query on another, and the two
     *  numbers would disagree with nobody able to say which was right. */
    check(
      'opportunities_stage_marks',
      sql`(${t.stage} = 'new') = (${t.contactedAt} is null) and (${t.stage} = 'advised') = (${t.advisedAt} is not null)`,
    ),

    /** Same argument for the close: a deal is closed exactly when it has a
     *  closing time. */
    check(
      'opportunities_closed_mark',
      sql`(${t.outcome} = 'open') = (${t.closedAt} is null)`,
    ),

    /** A closed deal has to say why. The brief asks for it, and a list of
     *  losses with no reasons teaches a team lead nothing. */
    check(
      'opportunities_outcome_reason',
      sql`${t.outcome} = 'open' or ${t.outcomeReason} is not null`,
    ),

    /** Who signed and when travel together or not at all. */
    check(
      'opportunities_confirm_pair',
      sql`(${t.confirmedById} is null) = (${t.confirmedAt} is null)`,
    ),

    /** Nothing open can be reconciled: there is no paperwork to check against
     *  until the deal has actually landed one way or the other. */
    check(
      'opportunities_confirm_closed',
      sql`${t.confirmedAt} is null or ${t.outcome} <> 'open'`,
    ),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Opportunity products
 * ────────────────────────────────────────────────────────────────────────── */

/** What was actually sold on a deal that landed.
 *
 *  A child table rather than a column because the branch report needs two
 *  things a single column cannot give it. One deal can carry more than one
 *  product — the branch's own figures show 306 products against 284 successful
 *  deals, so roughly one in thirteen is a cross-sell — and each product is
 *  measured in its own currency of sorts: an overdraft is reported by the
 *  limit granted, a loan by the balance drawn. One `amount` per product row
 *  covers both, where one `value` on the parent covers neither.
 *
 *  Only ever written on a won deal. The parent's `value` stays what the
 *  salesperson expected up front, so the gap between expectation and outcome
 *  survives instead of being overwritten. */
export const opportunityProducts = pgTable(
  'opportunity_products',
  {
    id: text('id').primaryKey(),
    opportunityId: text('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),

    product: text('product').notNull(),
    /** Whole đồng. What the figure means follows the product: a limit for an
     *  overdraft, a drawn balance for a loan, the annual fee for a card. */
    amount: bigint('amount', { mode: 'number' }).notNull(),

    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One row per product per deal. Two rows for the same product would
     *  double a branch's count of cards sold, which is the headline figure. */
    uniqueIndex('opportunity_products_key').on(t.opportunityId, t.product),
    /** The report's own query: count and sum, grouped by product. */
    index('opportunity_products_product').on(t.product),

    check(
      'opportunity_products_product',
      sql`${t.product} in ('card', 'od', 'usl', 'loan', 'casa', 'insurance', 'other')`,
    ),
    check('opportunity_products_amount', sql`${t.amount} >= 0`),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Audit events
 * ────────────────────────────────────────────────────────────────────────── */

/** Everything that has happened to a lead: who, when, what changed, and why.
 *
 *  Append-only, written inside the same transaction as the change it records,
 *  so the log cannot disagree with the row it describes.
 *
 *  It carries two columns a plain audit trail would not:
 *
 *    heldMs  how long the lead sat where it was before this event. Computed
 *            once at write time. This is what a team lead's chasing actually
 *            runs on — a lead handed out on Monday and first called on Friday
 *            is four days of `heldMs` on its `contacted` event, and the branch
 *            average is one SELECT rather than a window function over the
 *            whole log on every render.
 *    seq     position within this lead's own history. Two events can land in
 *            the same millisecond; a trace drawn from timestamps alone would
 *            then render them in either order.
 *
 *  What it no longer carries is a direction or a recipient. Both existed to
 *  describe a deal being handed up a chain of approvers, and there is no such
 *  chain: a lead belongs to one salesperson from the day it arrives. The one
 *  handover left — an admin assigning an imported lead — is a change of owner
 *  like any other, and lands in `changes` where every other field change does. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    opportunityId: text('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),

    /** Position in this deal's history, starting at 1. */
    seq: integer('seq').notNull(),

    /** Who did it. An admin acting on someone's behalf lands here like anyone
     *  else — that is the point of keeping the technical account inside the
     *  same log rather than beside it. */
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),

    /** What happened. A closed set, because every timing question the branch
     *  asks is a group-by on this column. */
    kind: text('kind').notNull(),

    /** Milliseconds since the previous event on this lead. Null on the first,
     *  which has nothing to measure from. */
    heldMs: bigint('held_ms', { mode: 'number' }),

    /** Field-level before/after, e.g. { "value": [2000000000, 2500000000] }.
     *  A reassignment is `{ "ownerId": ["u_ha", "u_hai"] }` and needs no
     *  special column of its own. */
    changes: jsonb('changes').notNull().default(sql`'{}'::jsonb`),
    /** Why, in the actor's own words. Required on a loss and on a team lead's
     *  reconciliation note — a lost deal with no reason teaches nobody
     *  anything, which is the whole point of a team lead reading these. */
    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One lead's trace, in order. Also enforces that no two events claim the
     *  same position. */
    uniqueIndex('audit_events_trace').on(t.opportunityId, t.seq),
    /** Per-step timings across the branch: how long from handed out to first
     *  call, from first call to advice, from advice to close. */
    index('audit_events_kind_created').on(t.kind, t.createdAt),
    /** What one person has been doing, which is a team lead's other question. */
    index('audit_events_actor').on(t.actorId, t.createdAt),

    check('audit_events_seq', sql`${t.seq} >= 1`),
    check(
      'audit_events_kind',
      sql`${t.kind} in ('created', 'assigned', 'contacted', 'advised', 'won', 'lost', 'reopened', 'confirmed', 'edited')`,
    ),
    check('audit_events_held_ms', sql`${t.heldMs} is null or ${t.heldMs} >= 0`),

    /** The first event is the only one with nothing to measure from. Locking
     *  the two together stops a gap appearing in the middle of a trace, which
     *  would quietly bend every duration drawn from it. */
    check(
      'audit_events_first_event',
      sql`(${t.heldMs} is null) = (${t.seq} = 1)`,
    ),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Targets
 * ────────────────────────────────────────────────────────────────────────── */

/** What someone is expected to bring in over a period.
 *
 *  Small table, load-bearing: without it there is no gap, and without a gap
 *  the branch manager's screen is a list of numbers with nothing to say. Every
 *  question that makes the entry interesting — are we going to make it, what
 *  is missing, which deal closes it — is a subtraction from a row in here.
 *
 *  One table covers a person and a whole unit rather than two, because the
 *  branch manager's screen puts them side by side and a union of two shapes
 *  would be paid for on every read.
 *
 *  A unit row is not the sum of its people's rows. Branches routinely carry a
 *  number larger than what they hand out, so both are stored and neither is
 *  derived. */
export const targets = pgTable(
  'targets',
  {
    id: text('id').primaryKey(),

    /** `user` for one person, `unit` for a whole branch. */
    scope: text('scope').notNull(),
    /** Set on a user target, null on a unit target. */
    ownerId: text('owner_id').references(() => users.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    /** Narrows a unit target to one segment, so the branch manager can compare
     *  the SSE team against the retail team. Null means the whole unit. */
    segment: text('segment'),

    /** Period label, `2026-Q3`. Text rather than a date range: everyone says
     *  "quý ba", nobody says "1 July to 30 September", and a label groups and
     *  sorts correctly as it is. */
    period: text('period').notNull(),

    /** What is being measured, which decides what `amount` means.
     *
     *  The branch runs on `cr_rate` — the number on every report is "6% CR",
     *  and the gap column is leads × 6% minus deals won. Money targets exist
     *  alongside it rather than instead of it, because a conversion rate says
     *  nothing about whether the deals were worth having. */
    metric: text('metric').notNull().default('cr_rate'),
    /** The number, in the unit its metric implies: basis points for
     *  `cr_rate` (600 = 6%), a count for `deals`, whole đồng for `value`.
     *
     *  Basis points rather than a decimal so the column stays an integer and
     *  the gap arithmetic stays exact — a rate stored as a float turns "did we
     *  hit 6%" into a question about rounding. */
    amount: bigint('amount', { mode: 'number' }).notNull(),

    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('targets_period').on(t.period),
    index('targets_owner_period').on(t.ownerId, t.period),

    check('targets_scope', sql`${t.scope} in ('user', 'unit')`),
    check('targets_metric', sql`${t.metric} in ('cr_rate', 'deals', 'value')`),
    check('targets_amount', sql`${t.amount} > 0`),
    /** A conversion rate above 100% is a typo, and one that reaches a report
     *  makes every gap on it negative. */
    check(
      'targets_cr_rate_range',
      sql`${t.metric} <> 'cr_rate' or ${t.amount} <= 10000`,
    ),
    check('targets_segment', sql`${t.segment} is null or ${t.segment} in ('sse', 'rb')`),

    /** A personal target names a person; a unit target must not, or it would
     *  be counted twice — once as the branch's and once as someone's. */
    check(
      'targets_owner_by_scope',
      sql`case when ${t.scope} = 'user' then ${t.ownerId} is not null else ${t.ownerId} is null end`,
    ),

    /** One number per person per metric per period, and one per
     *  unit-and-segment per metric per period. Two rows for the same thing
     *  means the gap depends on which one a query happens to read first, and
     *  the figure quietly stops matching itself between two screens.
     *
     *  `coalesce` rather than a plain unique index because Postgres treats
     *  NULLs as distinct, so unit rows — which have a null owner — would slip
     *  past it entirely. */
    uniqueIndex('targets_key').on(
      t.scope,
      sql`coalesce(${t.ownerId}, '')`,
      t.unitId,
      sql`coalesce(${t.segment}, '')`,
      t.metric,
      t.period,
    ),
  ],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Sessions
 * ────────────────────────────────────────────────────────────────────────── */

/** The cookie carries the raw token; the table stores only its hash, so
 *  reading the database straight does not let anyone forge a session.
 *
 *  One difference from the `home` version: no `credentialId`, because login
 *  here is a password rather than a passkey. Making five people enrol a
 *  WebAuthn device before filming is a risk this project does not need. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
)

/* ──────────────────────────────────────────────────────────────────────────
 * Inferred types and enums
 * ────────────────────────────────────────────────────────────────────────── */

export type Unit = typeof units.$inferSelect
export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Customer = typeof customers.$inferSelect
export type Signal = typeof signals.$inferSelect

/** What kind of thing was observed. The list comes straight from the two
 *  customer scenarios in the brief; `other` is the escape hatch so a
 *  salesperson is never blocked from recording something real. */
export const SIGNAL_TYPES = [
  'cash_flow',
  'product_gap',
  'need',
  'competition',
  'deadline',
  'documents',
  'other',
] as const
export type SignalType = (typeof SIGNAL_TYPES)[number]

export const SIGNAL_SOURCES = ['sale', 'system', 'ai'] as const
export type SignalSource = (typeof SIGNAL_SOURCES)[number]

export type Opportunity = typeof opportunities.$inferSelect
export type OpportunityProduct = typeof opportunityProducts.$inferSelect

/** The funnel, in order. Three steps, matching what the branch already counts:
 *  a lead exists, someone has called it, someone has advised on a product.
 *
 *  Winning or losing is not a fourth step — it is the `outcome` column, and it
 *  can land from `contacted` without passing through `advised`. Keeping the
 *  two apart is what lets the report say "42% advised, 1.8% converted" about
 *  the same population without the numbers arguing with each other. */
export const STAGES = ['new', 'contacted', 'advised'] as const
export type Stage = (typeof STAGES)[number]

/** Position in the funnel, for "has this lead got at least as far as X".
 *  Never persisted — the timestamps are the record. */
export const STAGE_ORDER: Record<Stage, number> = {
  new: 0,
  contacted: 1,
  advised: 2,
}

export const OUTCOMES = ['open', 'won', 'lost'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** What MSB sells, as the branch report groups it: cards, overdrafts,
 *  unsecured loans, secured lending, current accounts and insurance.
 *
 *  Closed rather than free text because the report is literally one column per
 *  product. `other` is the escape hatch, and a build-up of `other` rows is the
 *  signal that this list needs another entry — not that the list was a
 *  mistake. */
export const PRODUCTS = [
  'card',
  'od',
  'usl',
  'loan',
  'casa',
  'insurance',
  'other',
] as const
export type Product = (typeof PRODUCTS)[number]

/** How a lead reached the system: pushed in from a campaign file, or found by
 *  the salesperson themselves. */
export const LEAD_SOURCES = ['import', 'manual'] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export const CREATED_VIA = ['manual', 'ai'] as const
export type CreatedVia = (typeof CREATED_VIA)[number]

export type AuditEvent = typeof auditEvents.$inferSelect

/** Everything that can happen to a lead. `reopened` exists because a customer
 *  who said no in March can say yes in June, and forcing that through a new
 *  row would count them twice in the funnel. */
export const AUDIT_KINDS = [
  'created',
  'assigned',
  'contacted',
  'advised',
  'won',
  'lost',
  'reopened',
  'confirmed',
  'edited',
] as const
export type AuditKind = (typeof AUDIT_KINDS)[number]

export type Target = typeof targets.$inferSelect

export const TARGET_SCOPES = ['user', 'unit'] as const
export type TargetScope = (typeof TARGET_SCOPES)[number]

/** What a target measures, which decides what its `amount` means: basis
 *  points, a count of deals, or whole đồng. */
export const TARGET_METRICS = ['cr_rate', 'deals', 'value'] as const
export type TargetMetric = (typeof TARGET_METRICS)[number]

/** Rates are stored as basis points so the gap arithmetic stays in integers.
 *  One place to divide, so nobody has to remember the factor. */
export const BPS_PER_UNIT = 10_000

/** Why a deal is stuck. A closed set so identical blockers group together
 *  across the branch — it is how a team lead sees that eleven people are
 *  losing to the same competitor rather than eleven separate problems. */
export const BLOCKER_CODES = [
  'rate',
  'speed',
  'experience',
  'documents',
  'collateral',
  'policy',
  'competitor',
  'customer_hesitation',
  'other',
] as const
export type BlockerCode = (typeof BLOCKER_CODES)[number]

/** The four roles. Authorization reads this and nothing else. */
export const ROLES = ['sale', 'team_lead', 'bm', 'admin'] as const
export type Role = (typeof ROLES)[number]

/** The roles that make up the sales line, in reporting order.
 *
 *  Every query that counts people, builds a pipeline, sums a target or fills a
 *  dashboard must filter on this list rather than on the whole users table.
 *  An admin is a technical account: leaving it in would make the branch
 *  manager's unit look one head larger and skew every per-person average.
 *  Admin actions still land in the audit log like anyone else's. */
export const SALES_ROLES = ['bm', 'team_lead', 'sale'] as const
export type SalesRole = (typeof SALES_ROLES)[number]

export function isSalesRole(role: string): role is SalesRole {
  return (SALES_ROLES as readonly string[]).includes(role)
}

/** SSE covers small businesses and household traders, RB covers individuals. */
export const SEGMENTS = ['sse', 'rb'] as const
export type Segment = (typeof SEGMENTS)[number]

/** Career grades. Placeholder list — replace both this constant and the
 *  `users_level` check once MSB's real grade ladder is confirmed. */
export const LEVELS = ['cv1', 'cv2', 'cv3', 'cvc', 'tn', 'gd'] as const
export type Level = (typeof LEVELS)[number]

/* ──────────────────────────────────────────────────────────────────────────
 * The assistant
 * ────────────────────────────────────────────────────────────────────────── */

/** One thread of conversation with the assistant.
 *
 *  Owned by a person, never by a team: two salespeople asking about the same
 *  customer are having two different conversations, and neither should read
 *  the other's. The row scope that guards customers does not apply here —
 *  a conversation is not a branch record, it is somebody's working notes.
 *
 *  `subjectId` anchors a thread to what it is about, so opening the assistant
 *  from a customer file comes back to the same thread next time rather than
 *  starting blank. A free-standing chat leaves it null. */
export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),

    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Written by the model after the first exchange, because "Cuộc trò
     *  chuyện 14:03" is not a title anybody can find again. */
    title: text('title').notNull().default(''),

    /** `customer`, `opportunity`, or null for a thread about nothing in
     *  particular. */
    subjectKind: text('subject_kind'),
    subjectId: text('subject_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Sorted on, so the list opens where the person left off. Kept as its own
     *  column rather than read from the last message, which would be a
     *  subquery on every row of the list. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversations_owner_recent').on(t.ownerId, t.lastMessageAt),
    check(
      'conversations_subject_pair',
      sql`(${t.subjectKind} is null) = (${t.subjectId} is null)`,
    ),
    check(
      'conversations_subject_kind',
      sql`${t.subjectKind} is null or ${t.subjectKind} in ('customer', 'opportunity')`,
    ),
  ],
)

export type Conversation = typeof conversations.$inferSelect

/** One turn, as the model understands a turn.
 *
 *  `content` holds the blocks — text, and the model's own tool_use blocks —
 *  which is what has to go back into the next request for the thread to
 *  continue making sense. Tool *results* deliberately do not live here: they
 *  can be fifty rows of a report, they are what the screen draws its charts
 *  from, and how much of them to replay into context is a decision the chat
 *  service makes per request. They live in `tool_calls` instead. */
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),

    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    /** Position in the thread, from 1. */
    seq: integer('seq').notNull(),

    role: text('role').notNull(),

    /** Anthropic content blocks, verbatim. Stored as sent and received so a
     *  thread replays exactly rather than approximately. */
    content: jsonb('content').notNull().default(sql`'[]'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_conversation_seq').on(t.conversationId, t.seq),
    check('messages_role', sql`${t.role} in ('user', 'assistant')`),
  ],
)

export type Message = typeof messages.$inferSelect

/** Every tool the assistant reached for, and what came back.
 *
 *  Three jobs at once, which is why it is a table rather than a field:
 *
 *  - the screen draws its charts and tables from `result`, so a figure in the
 *    chat comes from the same query the dashboard runs and never from
 *    something the model typed;
 *  - a write tool waits here as `pending` until a person approves it, and the
 *    row is what the approval is checked against;
 *  - it is the record of what the assistant read on somebody's behalf, which
 *    a bank is going to ask about.
 *
 *  `inputHash` exists for the second job. Approving "set the due date to
 *  26/09 on OPP-123" must not become a licence to run the same tool with
 *  different arguments, so the approval is checked against a hash of the
 *  input rather than against the tool's name. */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: text('id').primaryKey(),

    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    /** The assistant turn that asked for it. */
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),

    /** The model's own id for the block, which is what a tool_result must be
     *  addressed to when the thread continues. */
    toolUseId: text('tool_use_id').notNull(),

    name: text('name').notNull(),
    input: jsonb('input').notNull().default(sql`'{}'::jsonb`),
    inputHash: text('input_hash').notNull(),

    /** `done` for a read that ran straight away; `pending` for a write waiting
     *  on a person; then `approved`, `denied`, or `failed`. */
    status: text('status').notNull().default('done'),

    /** What the tool returned. Null while pending, and null on a denial —
     *  there is nothing to draw and nothing to replay. */
    result: jsonb('result'),

    /** Why it failed, or the person's words when they declined. */
    note: text('note'),

    /** Who approved or declined, and when. Both null on a read: nobody was
     *  asked, and recording a decision nobody made would be a lie in the one
     *  table somebody will audit. */
    decidedById: text('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    /** How long the tool itself took, so a slow thread can be blamed on the
     *  right half. */
    ms: integer('ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tool_calls_use_id').on(t.toolUseId),
    index('tool_calls_conversation').on(t.conversationId, t.createdAt),
    check(
      'tool_calls_status',
      sql`${t.status} in ('pending', 'done', 'approved', 'denied', 'failed')`,
    ),
    /** A decision has a decider and a time, or it has neither. */
    check(
      'tool_calls_decision_pair',
      sql`(${t.decidedById} is null) = (${t.decidedAt} is null)`,
    ),
    /** Nothing is approved or denied without somebody's name on it. */
    check(
      'tool_calls_decided_by',
      sql`${t.status} not in ('approved', 'denied') or ${t.decidedById} is not null`,
    ),
    /** A pending call has not run, so it cannot have a result yet. */
    check('tool_calls_pending_empty', sql`${t.status} <> 'pending' or ${t.result} is null`),
  ],
)

export type ToolCall = typeof toolCalls.$inferSelect

/* No display labels live here, and none live anywhere else in the API.
 * The API speaks codes — `sale`, `sse`, `cv1` — and the web app owns the
 * dictionary that turns them into words. That keeps every user-facing string
 * in one place, so adding English later is a second dictionary file rather
 * than a sweep through controllers. See apps/web/src/i18n. */
