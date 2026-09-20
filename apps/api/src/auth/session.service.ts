import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Response } from 'express'
import { and, eq, gt, lt } from 'drizzle-orm'
import { AUTH_CONFIG, type AuthConfig } from '../config/auth-config'
import { DB, type Db } from '../db/db.module'
import { sessions, users } from '../db/schema'

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** Opens a session and sets an httpOnly cookie. The cookie carries the raw
   *  token; the table stores only its hash. */
  async start(
    res: Response,
    input: { userId: string; userAgent?: string; ip?: string },
  ) {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs)

    /** Sweep expired rows on the way in — cheap here, and it keeps the
     *  "open sessions" screen honest without a scheduled job. */
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()))

    await this.db.insert(sessions).values({
      id: randomUUID(),
      tokenHash: hashToken(token),
      userId: input.userId,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      ip: input.ip?.slice(0, 64) ?? null,
      expiresAt,
    })

    res.cookie(this.config.cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
      expires: expiresAt,
    })
  }

  /** Resolves the cookie to a session and moves the last-seen mark.
   *
   *  A deactivated account is rejected here rather than at login, so switching
   *  someone off takes effect on their next request instead of whenever they
   *  next sign in. */
  async resolve(token: string | undefined) {
    if (!token) return null

    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1)

    if (!row || !row.user.active) return null

    const idle = this.config.idleTimeoutMs
    if (idle > 0 && Date.now() - row.session.lastSeenAt.getTime() > idle) {
      await this.db.delete(sessions).where(eq(sessions.id, row.session.id))
      return null
    }

    await this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id))

    return { session: row.session, user: row.user }
  }

  async end(res: Response, token: string | undefined) {
    if (token) await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
    res.clearCookie(this.config.cookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
    })
  }

  /** Signs an account out everywhere.
   *
   *  A password reset that left the old sessions alive would be no reset at
   *  all: whoever prompted it — a shared password, a laptop left on a desk —
   *  would still be signed in on the device that caused the problem. */
  async revokeAllFor(userId: string) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId))
  }
}
