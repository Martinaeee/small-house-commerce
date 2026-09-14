import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminUploadsController } from './admin/uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminUploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
