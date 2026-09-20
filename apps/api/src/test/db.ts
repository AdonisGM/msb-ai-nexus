import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from '../db/schema'
import type { Db } from '../db/db.module'
import { testDatabaseUrl } from './global-setup'

const client = postgres(testDatabaseUrl(), { max: 4, onnotice: () => {} })

/** The connection every test shares. Migrations have already run in global
 *  setup, so a test file only has to clear the tables it dirties. */
export const testDb: Db = drizzle(client, { schema })

/** Order does not matter — `cascade` handles the foreign keys — but listing
 *  the tables explicitly does: a new table added to the schema and forgotten
 *  here would leak rows between tests, and the failure shows up somewhere
 *  unrelated hours later. */
const TABLES = [
  'tool_calls',
  'messages',
  'conversations',
  'audit_events',
  'opportunity_products',
  'opportunities',
  'signals',
  'customers',
  'targets',
  'sessions',
  'users',
  'units',
] as const

/** Empties every table. Call it in `beforeEach` so each test starts from
 *  nothing and can be read on its own, without tracing what ran before it. */
export async function resetDb() {
  await testDb.execute(sql.raw(`truncate table ${TABLES.join(', ')} restart identity cascade`))
}

export async function closeDb() {
  await client.end({ timeout: 5 })
}
