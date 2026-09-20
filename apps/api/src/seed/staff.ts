import type { Db } from '../db/db.module'
import { ACCOUNT_IDS, hashPassword, upsertUsers, type SeedUser } from './accounts'

/** The rest of the branch, for the bulk seed.
 *
 *  The six accounts from `accounts.ts` are a walkthrough cast: one manager,
 *  two team leads, one salesperson each. That is enough to film the funnel and
 *  not enough to read a dashboard — a ranking of two people is a coin toss, and
 *  a branch of two teams has no middle band.
 *
 *  So this adds a third team and eleven more salespeople, keeping the six
 *  originals exactly as they are: the walkthrough in the docs still works, and
 *  the same login still lands on the same book.
 *
 *  Names are invented. Nobody at MSB is in this file. */

export const STAFF_IDS = {
  leadRb2: 'usr_tl_rb_02',
} as const

type Recruit = {
  /** Short id fragment, which becomes `usr_sale_<seg><n>`. */
  n: number
  name: string
  level: SeedUser['level']
}

/** Team lead → their salespeople. The login code carries the segment and a
 *  branch-wide running number rather than a team number: people move between
 *  team leads, and a code that encodes their manager would be wrong the first
 *  time one did. */
const TEAMS = [
  {
    leadId: ACCOUNT_IDS.leadSse,
    segment: 'sse' as const,
    title: 'Chuyên viên khách hàng doanh nghiệp SSE',
    /** 01 is Hà, who already exists. */
    recruits: [
      { n: 2, name: 'Trần Thị Mai Anh', level: 'cv3' as const },
      { n: 3, name: 'Lê Quang Huy', level: 'cv2' as const },
      { n: 4, name: 'Phạm Thu Trang', level: 'cv1' as const },
    ],
  },
  {
    leadId: ACCOUNT_IDS.leadRb,
    segment: 'rb' as const,
    title: 'Chuyên viên khách hàng cá nhân',
    /** 01 is Hải. */
    recruits: [
      { n: 2, name: 'Nguyễn Khánh Chi', level: 'cvc' as const },
      { n: 3, name: 'Đỗ Minh Quân', level: 'cv3' as const },
      { n: 4, name: 'Vũ Hoàng Long', level: 'cv2' as const },
      { n: 5, name: 'Ngô Thanh Hương', level: 'cv1' as const },
    ],
  },
  {
    leadId: STAFF_IDS.leadRb2,
    segment: 'rb' as const,
    title: 'Chuyên viên khách hàng cá nhân',
    recruits: [
      { n: 6, name: 'Bùi Tuấn Kiệt', level: 'cv3' as const },
      { n: 7, name: 'Hoàng Diệu Linh', level: 'cv2' as const },
      { n: 8, name: 'Đặng Văn Thành', level: 'cv2' as const },
      { n: 9, name: 'Trịnh Bảo Ngọc', level: 'cv1' as const },
    ],
  },
] satisfies Array<{
  leadId: string
  segment: 'sse' | 'rb'
  title: string
  recruits: Recruit[]
}>

/** The second retail team lead. Reports to the same branch manager, which is
 *  what makes three rows appear on their dashboard instead of two. */
const LEAD_RB2: SeedUser = {
  id: STAFF_IDS.leadRb2,
  code: 'TL-RB-02',
  employeeCode: 'NV0007',
  name: 'Phan Thị Thu Hà',
  role: 'team_lead',
  title: 'Trưởng nhóm khách hàng cá nhân 2',
  level: 'tn',
  segment: 'rb',
  managerId: ACCOUNT_IDS.bm,
}

function recruitId(segment: 'sse' | 'rb', n: number): string {
  return `usr_sale_${segment}_${String(n).padStart(2, '0')}`
}

/** Everyone this file adds, in tree order: the team lead first, because a
 *  salesperson cannot point at a manager who is not there yet.
 *
 *  Staff numbers run in one sequence down the roster, continuing NV0001–NV0007
 *  above, so they read as a branch's intake rather than as three independent
 *  counters. */
export const EXTRA_STAFF: SeedUser[] = (() => {
  const roster: SeedUser[] = [LEAD_RB2]
  let employee = 8

  for (const team of TEAMS) {
    for (const recruit of team.recruits) {
      roster.push({
        id: recruitId(team.segment, recruit.n),
        code: `SALE-${team.segment.toUpperCase()}-${String(recruit.n).padStart(2, '0')}`,
        employeeCode: `NV${String(employee++).padStart(4, '0')}`,
        name: recruit.name,
        role: 'sale',
        title: team.title,
        level: recruit.level,
        segment: team.segment,
        managerId: team.leadId,
      })
    }
  }

  return roster
})()

/** Who sells what, and how well. Read by the bulk generator.
 *
 *  The rates are deliberately unequal, and unequal by team as well as by
 *  person: a dashboard whose every row sits on the same number cannot be used
 *  to tell whether the screen works. `crBps` is the share of that person's
 *  leads that end in a win — 600 is the 6% the branch is measured against. */
export type SalesProfile = {
  id: string
  segment: 'sse' | 'rb'
  /** Wins per thousand leads, in basis points. */
  crBps: number
  /** Relative volume. A senior carries more of the book than a first-year. */
  weight: number
}

export const SALES_PROFILES: SalesProfile[] = [
  /* Bùi Phương's team — the one the branch manager needs to talk to. */
  { id: ACCOUNT_IDS.saleSse, segment: 'sse', crBps: 520, weight: 1.15 },
  { id: recruitId('sse', 2), segment: 'sse', crBps: 430, weight: 1.1 },
  { id: recruitId('sse', 3), segment: 'sse', crBps: 300, weight: 1 },
  { id: recruitId('sse', 4), segment: 'sse', crBps: 180, weight: 0.8 },

  /* Huy's team — carrying the branch. */
  { id: ACCOUNT_IDS.saleRb, segment: 'rb', crBps: 780, weight: 1.1 },
  { id: recruitId('rb', 2), segment: 'rb', crBps: 960, weight: 1.2 },
  { id: recruitId('rb', 3), segment: 'rb', crBps: 700, weight: 1 },
  { id: recruitId('rb', 4), segment: 'rb', crBps: 640, weight: 0.95 },
  { id: recruitId('rb', 5), segment: 'rb', crBps: 480, weight: 0.75 },

  /* Phan Thị Thu Hà's team — just under the line. */
  { id: recruitId('rb', 6), segment: 'rb', crBps: 620, weight: 1.05 },
  { id: recruitId('rb', 7), segment: 'rb', crBps: 560, weight: 1 },
  { id: recruitId('rb', 8), segment: 'rb', crBps: 470, weight: 0.95 },
  { id: recruitId('rb', 9), segment: 'rb', crBps: 380, weight: 0.8 },
]

/** Adds the third team and the eleven recruits. Leaves the six walkthrough
 *  accounts untouched — `seedAccounts` owns those and runs first. */
export async function seedStaff(db: Db, password: string) {
  await upsertUsers(db, EXTRA_STAFF, hashPassword(password))
  return EXTRA_STAFF
}
