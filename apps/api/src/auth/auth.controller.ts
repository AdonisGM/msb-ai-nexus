import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AUTH_CONFIG, type AuthConfig } from '../config/auth-config'
import type { User } from '../db/schema'
import { AuthService } from './auth.service'
import { AuthGuard, type AuthedRequest } from './auth.guard'
import { LoginDto } from './dto'
import { SessionService } from './session.service'

/** The account shape the web app receives.
 *
 *  Codes only, never words: `role` is 'sale', not 'Nhân viên kinh doanh'. The
 *  dictionary that turns these into Vietnamese lives in the web app, which is
 *  what makes adding another language a second dictionary file rather than a
 *  sweep through controllers.
 *
 *  `passwordHash` is dropped here and must never be added back. */
export function publicUser(user: User, manager: Manager = null) {
  return {
    id: user.id,
    code: user.code,
    name: user.name,
    role: user.role,
    title: user.title,
    level: user.level,
    segment: user.segment,
    unitId: user.unitId,
    managerId: user.managerId,
    /** Who they report to, by name.
     *
     *  Sent with the account rather than fetched per screen: a salesperson
     *  needs to know who signs off their wins and who is chasing them, and
     *  that line belongs on every screen they open. `managerId` alone is an
     *  opaque id the web app cannot render. */
    manager,
  }
}

type Manager = { id: string; name: string; role: string; title: string } | null

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  private token(req: Request) {
    return (req.cookies as Record<string, string> | undefined)?.[this.config.cookieName]
  }

  /** Who is signed in, or null. Unguarded on purpose: the router calls it on
   *  every load to decide between the app and the login screen, and a 401 for
   *  the ordinary logged-out case would be noise in the console. */
  @Get('status')
  async status(@Req() req: Request) {
    const found = await this.sessions.resolve(this.token(req))
    if (!found) return { user: null }
    return { user: publicUser(found.user, await this.auth.managerOf(found.user)) }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthedRequest) {
    return { user: publicUser(req.user!, await this.auth.managerOf(req.user!)) }
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(body.code, body.password)
    await this.sessions.start(res, {
      userId: user.id,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    })
    return { user: publicUser(user, await this.auth.managerOf(user)) }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.end(res, this.token(req))
  }
}
