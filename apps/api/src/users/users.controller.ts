import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { publicUser } from '../auth/auth.controller'
import { CreateUserDto, ListUsersDto, SetPasswordDto, UpdateUserDto } from './dto'
import { UsersService } from './users.service'

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The branch's org chart. No `@Roles`: everyone in a branch may see who
   *  works there and who reports to whom. What they may *read* is a different
   *  question, answered by the scope in the query layer. */
  @Get('tree')
  tree(@Req() req: AuthedRequest) {
    return this.users.tree(req.user!)
  }

  /** The roster. Admin only, like everything below it.
   *
   *  Declared before `:id` so the router does not read the empty path as a
   *  customer id — same reason `facets` sits above `:id` on customers. */
  @Get()
  @Roles('admin')
  list(@Query() query: ListUsersDto) {
    return this.users.list(query)
  }

  /** Everything below is the admin's. Managing accounts is not a sales job,
   *  and a team lead who could rewrite their own people's records could also
   *  rewrite who those records report to. */
  @Get(':id')
  @Roles('admin')
  async get(@Param('id') id: string) {
    return { user: publicUser(await this.users.get(id)) }
  }

  @Post()
  @Roles('admin')
  async create(@Req() req: AuthedRequest, @Body() body: CreateUserDto) {
    return { user: publicUser(await this.users.create(req.user!, body)) }
  }

  @Patch(':id')
  @Roles('admin')
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ) {
    return { user: publicUser(await this.users.update(req.user!, id, body)) }
  }

  /** Separate from the PATCH on purpose, so no careless edit can reset a
   *  password by accident. Returns nothing: the new password came from the
   *  caller, and echoing it back only puts it somewhere else. */
  @Post(':id/password')
  @HttpCode(204)
  @Roles('admin')
  async setPassword(@Param('id') id: string, @Body() body: SetPasswordDto) {
    await this.users.setPassword(id, body)
  }
}
