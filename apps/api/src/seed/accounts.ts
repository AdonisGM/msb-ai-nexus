import { hashSync } from 'bcryptjs'
import type { Db } from '../db/db.module'
import { units, users, type Level, type Role, type Segment } from '../db/schema'

/** Identifiers are hand-written and stable rather than generated, so running
 *  the seed twice updates the same rows instead of creating a second set, and
 *  so demo data can refer to an account by a readable id. */

export const UNIT_ID = 'unit_th'

export const ACCOUNT_IDS = {
  admin: 'usr_admin_01',
  bm: 'usr_bm_th_01',
  leadSse: 'usr_tl_sse_01',
  leadRb: 'usr_tl_rb_01',
  saleSse: 'usr_sale_sse_01',
  saleRb: 'usr_sale_rb_01',
} as const

type SeedUser = {
  id: string
  /** Login handle. */
  code: string
  /** Staff number, which is what a bulk upload of leads names people by.
   *  Invented for the trial — replace both this and the real numbers together
   *  when HR's list arrives. */
  employeeCode: string
  name: string
  role: Role
  title: string
  level: Level | null
  segment: Segment | null
  managerId: string | null
}

/** The technical account. No segment, no manager, and every sales query
 *  filters on SALES_ROLES, so it never lands in a report. */
const ADMIN: SeedUser = {
  id: ACCOUNT_IDS.admin,
  code: 'ADMIN-01',
  employeeCode: 'NV0001',
  name: 'Nguyễn Mạnh Tùng',
  role: 'admin',
  title: 'Quản trị hệ thống',
  level: null,
  segment: null,
  managerId: null,
}

/** The five operating accounts from the brief. Order matters: the branch
 *  manager is the root of the tree and has to exist before anyone points at
 *  them, which `users_manager_by_role` enforces. */
const OPERATORS: SeedUser[] = [
  {
    id: ACCOUNT_IDS.bm,
    code: 'BM-TH-01',
    employeeCode: 'NV0002',
    name: 'Đức Anh',
    role: 'bm',
    title: 'Giám đốc đơn vị',
    level: 'gd',
    segment: null,
    managerId: null,
  },
  {
    id: ACCOUNT_IDS.leadSse,
    code: 'TL-SSE-01',
    employeeCode: 'NV0003',
    name: 'Bùi Phương',
    role: 'team_lead',
    title: 'Trưởng nhóm khách hàng doanh nghiệp SSE',
    level: 'tn',
    segment: 'sse',
    managerId: ACCOUNT_IDS.bm,
  },
  {
    id: ACCOUNT_IDS.leadRb,
    code: 'TL-RB-01',
    employeeCode: 'NV0004',
    name: 'Huy',
    role: 'team_lead',
    title: 'Trưởng nhóm khách hàng cá nhân',
    level: 'tn',
    segment: 'rb',
    managerId: ACCOUNT_IDS.bm,
  },
  {
    id: ACCOUNT_IDS.saleSse,
    code: 'SALE-SSE-01',
    employeeCode: 'NV0005',
    name: 'Hà',
    role: 'sale',
    title: 'Chuyên viên khách hàng doanh nghiệp SSE',
    level: 'cv2',
    segment: 'sse',
    managerId: ACCOUNT_IDS.leadSse,
  },
  {
    id: ACCOUNT_IDS.saleRb,
    code: 'SALE-RB-01',
    employeeCode: 'NV0006',
    name: 'Hải',
    role: 'sale',
    title: 'Chuyên viên khách hàng cá nhân',
    level: 'cv2',
    segment: 'rb',
    managerId: ACCOUNT_IDS.leadRb,
  },
]

/** Creates the unit and the six accounts, or brings them back to this
 *  definition if they already exist. Safe to run at any time; it never touches
 *  customers or deals. */
export async function seedAccounts(db: Db, password: string) {
  const passwordHash = hashSync(password, 10)

  await db
    .insert(units)
    .values({ id: UNIT_ID, code: 'TH', name: 'Đơn vị TH', kind: 'branch' })
    .onConflictDoUpdate({ target: units.id, set: { code: 'TH', name: 'Đơn vị TH' } })

  const all = [ADMIN, ...OPERATORS]

  for (const user of all) {
    await db
      .insert(users)
      .values({ ...user, unitId: UNIT_ID, passwordHash, active: true })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          code: user.code,
          employeeCode: user.employeeCode,
          name: user.name,
          role: user.role,
          title: user.title,
          level: user.level,
          segment: user.segment,
          managerId: user.managerId,
          passwordHash,
          updatedAt: new Date(),
        },
      })
  }

  return all
}
