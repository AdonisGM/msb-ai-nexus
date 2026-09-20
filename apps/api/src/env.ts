import { config } from 'dotenv'
import { resolve } from 'node:path'

/** One .env at the repository root, shared by compose and the API. Import this
 *  module first in every entry point — main.ts, seed.ts, any future CLI — so
 *  the variables exist before anything reads them.
 *
 *  Two candidate paths because the process may start from the package folder
 *  (`pnpm --filter @nexus/api dev`) or from the repository root. dotenv keeps
 *  the first value it finds and never overwrites a real environment variable,
 *  so in Docker, where the values are injected, both files are simply absent
 *  and nothing happens. */
config({
  path: [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')],
  quiet: true,
})

export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`)
  return value
}

export const PORT = Number(process.env.PORT ?? 3100)
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5273'

/** How many proxies sit in front, for Express to walk back through when
 *  working out who the caller is.
 *
 *  Zero on a laptop, one behind nginx. Without it `req.ip` is whatever opened
 *  the socket — which in production is nginx — and every row in `sessions`
 *  records 127.0.0.1. That column exists to tell two unfamiliar devices apart,
 *  so filling it with the same address for everyone quietly removes the only
 *  thing it was for.
 *
 *  A count rather than `true`: `true` trusts the whole X-Forwarded-For chain,
 *  including the part the caller wrote themselves, so anyone could claim any
 *  address. One means "believe exactly the last hop", and nginx is told to set
 *  that header to the single address it resolved. */
export const TRUST_PROXY = Number(process.env.TRUST_PROXY ?? 0)

/* Cookie and session settings live in config/auth-config.ts, not here, so
 * there is one owner for them rather than two that can drift apart. */
