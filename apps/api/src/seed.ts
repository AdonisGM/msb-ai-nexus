import './env'

import { drizzle } from 'drizzle-orm/postgres-js'
import { createSql } from './db/db.module'
import * as schema from './db/schema'
import { required } from './env'
import { seedAccounts } from './seed/accounts'
import { seedBulk } from './seed/bulk'
import { seedDemo } from './seed/demo'
import { DEFAULT_DEALS } from './seed/generate'
import { seedStaff } from './seed/staff'

/** `pnpm seed` writes the six accounts and leaves everything else alone.
 *
 *  `pnpm seed:demo` also rebuilds the hand-written walkthrough — forty-odd
 *  leads, each one chosen to say something during a demo.
 *
 *  `pnpm seed:bulk` instead hires the rest of the branch and generates a
 *  year of its work, which is what the dashboard needs to be worth reading:
 *  a ranking of two salespeople is a coin toss and a trend of two bars is a
 *  rumour.
 *
 *  The last two are alternatives, not layers — both wipe the same tables — so
 *  they are separate commands rather than one with a surprise. */
async function main() {
  const demo = process.argv.includes('--demo')
  const bulk = process.argv.includes('--bulk')

  if (demo && bulk) {
    throw new Error('Pick one: --demo builds the walkthrough, --bulk builds a year at scale.')
  }

  /** Every demo account shares one password. Deliberate: five people swap
   *  roles quickly while filming, and a forgotten password mid-take is a worse
   *  risk than a weak one in a database holding no real customers. It is never
   *  committed — it comes from .env. */
  const password = required('SEED_PASSWORD')
  const deals = numberArg('--deals') ?? DEFAULT_DEALS

  const sql = createSql(1)
  const db = drizzle(sql, { schema })

  try {
    const accounts = await seedAccounts(db, password)
    console.log(`Seeded 1 unit and ${accounts.length} accounts.`)
    for (const account of accounts) {
      console.log(`  ${account.code.padEnd(12)} ${account.name.padEnd(18)} ${account.role}`)
    }

    if (bulk) {
      const staff = await seedStaff(db, password)
      console.log(`\nHired ${staff.length} more accounts, same password.`)
      for (const account of staff) {
        console.log(`  ${account.code.padEnd(12)} ${account.name.padEnd(18)} ${account.role}`)
      }

      const started = Date.now()
      const result = await seedBulk(db, { deals })
      console.log(
        `\nSeeded ${result.customers} customers and ${result.opportunities} opportunities` +
          ` in ${Math.round((Date.now() - started) / 1000)}s, replayed through the services so` +
          ` the audit trail is real.`,
      )
      return
    }

    if (demo) {
      const result = await seedDemo(db)
      console.log(
        `\nSeeded ${result.customers} customers and ${result.opportunities} opportunities,` +
          ` replayed through the services so the audit trail is real.`,
      )
      return
    }

    console.log('\nRun with --demo for the walkthrough, or --bulk for a year at scale.')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** `--deals 2000`, or nothing. Rejected rather than silently ignored when it
 *  is not a number, because a typo that halves the dataset is a typo nobody
 *  notices until the charts look wrong. */
function numberArg(flag: string): number | undefined {
  const at = process.argv.indexOf(flag)
  if (at < 0) return undefined

  const value = Number(process.argv[at + 1])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} needs a positive number, got: ${process.argv[at + 1] ?? '(nothing)'}`)
  }
  return Math.floor(value)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
