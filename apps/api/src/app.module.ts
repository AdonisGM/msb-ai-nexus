import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module'
import { CustomersModule } from './customers/customers.module'
import { DbModule } from './db/db.module'
import { OpportunitiesModule } from './opportunities/opportunities.module'
import { SignalsModule } from './signals/signals.module'
import { TargetsModule } from './targets/targets.module'
import { UsersModule } from './users/users.module'
import { HealthController } from './health.controller'

@Module({
  imports: [DbModule, AuthModule, CustomersModule, OpportunitiesModule, SignalsModule, TargetsModule, UsersModule],
  controllers: [HealthController],
})
export class AppModule {}
