import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { CustomersService } from './customers.service'
import { CreateCustomerDto, ListCustomersDto, UpdateCustomerDto } from './dto'

/** Reading is open to the whole sales line — a branch manager needs the file
 *  behind a deal they are deciding on. What differs is how much comes back,
 *  and that is the scope's job, not the guard's.
 *
 *  Writing is limited to the people who actually hold relationships. */
@Controller('customers')
@UseGuards(AuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListCustomersDto) {
    return this.customers.list(req.user!, query)
  }

  /** The values behind the two free-text pickers on the list screen. Declared
   *  before `:id` or the router would read "facets" as a customer id. */
  @Get('facets')
  facets(@Req() req: AuthedRequest) {
    return this.customers.facets(req.user!)
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.customers.get(req.user!, id)
  }

  @Post()
  @Roles('sale', 'team_lead')
  create(@Req() req: AuthedRequest, @Body() body: CreateCustomerDto) {
    return this.customers.create(req.user!, body)
  }

  @Patch(':id')
  @Roles('sale', 'team_lead')
  update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.customers.update(req.user!, id, body)
  }
}
