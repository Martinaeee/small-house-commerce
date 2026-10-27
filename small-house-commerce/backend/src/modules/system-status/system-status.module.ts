import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SystemStatusController } from './system-status.controller.js';
import { SystemStatusService } from './system-status.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SystemStatusController],
  providers: [SystemStatusService],
})
export class SystemStatusModule {}
