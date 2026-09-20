import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ReportsController } from './reports.controller'
import { ReportsService } from './reports.service'

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  /** The assistant reads through this service too, so the scope it inherits
   *  is the one already tested here rather than a second copy of the rule. */
  exports: [ReportsService],
})
export class ReportsModule {}
