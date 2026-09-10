import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  // AuthModule is imported for its exported JwtModule: the controller's guards
  // (JwtAuthGuard, PermissionsGuard) inject JwtService. Module instances are
  // singletons, so the auth routes are not duplicated by this import.
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
