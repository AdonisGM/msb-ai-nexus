import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CustomersModule } from '../customers/customers.module'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { ReportsModule } from '../reports/reports.module'
import { SignalsModule } from '../signals/signals.module'
import { TargetsModule } from '../targets/targets.module'
import { UsersModule } from '../users/users.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'

/** The assistant reaches the branch's data through the same services every
 *  controller uses — imported here rather than re-implemented, so the scope
 *  rules it inherits are the ones that are already tested. */
@Module({
  imports: [
    AuthModule,
    CustomersModule,
    OpportunitiesModule,
    SignalsModule,
    ReportsModule,
    UsersModule,
    TargetsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class AiModule {}
