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
import {
  ActDto,
  AssignOpportunityDto,
  CreateOpportunityDto,
  ListOpportunitiesDto,
  UpdateOpportunityDto,
} from './dto'
import { OpportunitiesService } from './opportunities.service'
import type { ActionName } from './funnel'

@Controller('opportunities')
@UseGuards(AuthGuard, RolesGuard)
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListOpportunitiesDto) {
    return this.opportunities.list(req.user!, query)
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.opportunities.get(req.user!, id)
  }

  @Get(':id/history')
  history(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.opportunities.history(req.user!, id)
  }

  @Post()
  @Roles('sale', 'team_lead')
  create(@Req() req: AuthedRequest, @Body() body: CreateOpportunityDto) {
    return this.opportunities.create(req.user!, body)
  }

  @Patch(':id')
  @Roles('sale', 'team_lead')
  update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateOpportunityDto,
  ) {
    return this.opportunities.update(req.user!, id, body)
  }

  /** One endpoint for every button.
   *
   *  The alternative — a route per action — would put the rules in the routing
   *  table as well as in the funnel table, and the two would drift. Here the
   *  action is data and the table is the only thing that decides.
   *
   *  No `@Roles` either: which buttons a person may press depends on whether
   *  the lead is theirs, not on their job title, and only the service can see
   *  that. A role guard here would be a second, coarser copy of a rule that
   *  already exists. */
  @Post(':id/actions/:action')
  @HttpCode(200)
  act(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: ActDto,
  ) {
    return this.opportunities.act(req.user!, id, action as ActionName, body)
  }

  /** Handing a lead to someone else. The distribution half of the system: a
   *  bulk upload matches most rows by staff number, and the rest are placed
   *  here by hand. */
  @Post(':id/assign')
  @HttpCode(200)
  @Roles('admin')
  assign(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: AssignOpportunityDto,
  ) {
    return this.opportunities.assign(req.user!, id, body.ownerId)
  }
}
