import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ReportQuery } from './dto'
import { ReportsService } from './reports.service'

/** The figures behind the two dashboards.
 *
 *  Guarded to the two roles that read rather than work. A salesperson has
 *  their own screens for their own book and no business seeing a colleague's
 *  conversion rate — the row scope would hide the rows anyway, but a report
 *  that returns a single-person "team" is a report that invites the question. */
@Controller('reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles('team_lead', 'bm')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('funnel')
  funnel(@Req() req: AuthedRequest, @Query() query: ReportQuery) {
    return this.reports.funnel(req.user!, query)
  }

  @Get('by-owner')
  byOwner(@Req() req: AuthedRequest, @Query() query: ReportQuery) {
    return this.reports.byOwner(req.user!, query)
  }

  @Get('by-team')
  byTeam(@Req() req: AuthedRequest, @Query() query: ReportQuery) {
    return this.reports.byTeam(req.user!, query)
  }

  /** One route for three groupings. The shape is identical and only the
   *  column differs, so three near-copies would be three places to fix the
   *  next time the scope rule changes. */
  @Get('breakdown/:by')
  breakdown(
    @Req() req: AuthedRequest,
    @Param('by') by: string,
    @Query() query: ReportQuery,
  ) {
    const key = by === 'blocker' || by === 'segment' ? by : 'product'
    return this.reports.breakdown(req.user!, query, key)
  }

  @Get('monthly')
  monthly(@Req() req: AuthedRequest, @Query() query: ReportQuery) {
    return this.reports.monthly(req.user!, query)
  }
}
