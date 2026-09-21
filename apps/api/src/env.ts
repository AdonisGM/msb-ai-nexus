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

/** The key the assistant talks to Anthropic with.
 *
 *  Allowed to be absent, and deliberately so: the branch's own screens — the
 *  customer book, the funnel, the figures — are the part that has to work at a
 *  demo, and none of them need a model. A missing key turns the assistant off
 *  and leaves everything else running, rather than refusing to boot. */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''

/** `live` talks to the model. `off` answers every AI request with a plain
 *  "not configured", which is also what an empty key does.
 *
 *  A switch rather than only the key's presence, so a key that exists can be
 *  silenced without being deleted — during a rehearsal, or when a demo runs on
 *  a laptop nobody wants billing from. */
export const AI_ENABLED = (process.env.AI_MODE ?? 'live') === 'live' && ANTHROPIC_API_KEY !== ''

/** Whether AI turns are reported to Langfuse.
 *
 *  Both keys or nothing. A public key on its own reaches an endpoint that
 *  rejects it on every turn, which is a stream of warnings rather than a
 *  feature — and the assistant itself works identically either way. */
export const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY ?? ''
export const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY ?? ''

/** Langfuse's own default, repeated here because the exporter is built by
 *  hand in `tracing.ts` and an empty URL would post the branch's prompts
 *  nowhere at all rather than visibly failing. */
export const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'

export const LANGFUSE_ENABLED = Boolean(LANGFUSE_PUBLIC_KEY) && Boolean(LANGFUSE_SECRET_KEY)

/** Where chat attachments live: any S3-compatible store. SeaweedFS in both
 *  compose files, but nothing here knows that, so moving to a hosted bucket
 *  later is four variables rather than a code change.
 *
 *  Optional in the same way the model key is. Without it the assistant still
 *  answers; it just cannot take a file, and the web hides the paperclip. */
export const S3_ENDPOINT = process.env.S3_ENDPOINT ?? ''
export const S3_REGION = process.env.S3_REGION || 'us-east-1'
export const S3_BUCKET = process.env.S3_BUCKET || 'nexus-attachments'
export const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? ''
export const S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? ''

export const STORAGE_ENABLED =
  S3_ENDPOINT !== '' && S3_ACCESS_KEY !== '' && S3_SECRET_KEY !== ''

/* Cookie and session settings live in config/auth-config.ts, not here, so
 * there is one owner for them rather than two that can drift apart. */
