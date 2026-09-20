import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { compare } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module'
import { users, type User } from '../db/schema'

/** A real bcrypt hash of a string nobody holds. Compared against when the
 *  account code does not exist, so a wrong code and a wrong password take the
 *  same time to fail and the endpoint cannot be used to enumerate accounts. */
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.4bXvXCZqZ/bfBPAqpVyUPfLbPJKe'

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Verifies a code and password, returning the account.
   *
   *  Every failure raises the same message. Telling the caller which half was
   *  wrong is a gift to anyone guessing, and it helps a real user not at all —
   *  they retype both anyway. */
  async login(code: string, password: string): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.code, code)).limit(1)

    const ok = await compare(password, user?.passwordHash ?? DUMMY_HASH)
    if (!user || !ok || !user.active) throw new UnauthorizedException('invalid_credentials')

    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id))

    return user
  }

  /** The person an account reports to, for the line under their name.
   *
   *  Sent with the session rather than fetched per screen: a salesperson needs
   *  to know who signs off their wins and who is chasing them, and `managerId`
   *  on its own is an opaque id the web app cannot render.
   *
   *  Lives here rather than in UsersService so the dependency runs one way —
   *  the users module needs the auth guard, and the reverse edge would be a
   *  cycle for the sake of one query. */
  async managerOf(user: User) {
    if (!user.managerId) return null

    const [row] = await this.db
      .select({ id: users.id, name: users.name, role: users.role, title: users.title })
      .from(users)
      .where(eq(users.id, user.managerId))
      .limit(1)

    return row ?? null
  }
}
