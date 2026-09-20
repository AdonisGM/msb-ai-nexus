import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  /** The assistant reads through this service too, so the scope it inherits
   *  is the one already tested here rather than a second copy of the rule. */
  exports: [UsersService],
})
export class UsersModule {}
