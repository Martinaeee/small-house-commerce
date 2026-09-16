import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsService } from './settings.service.js';
import { StorefrontSettingsController } from './storefront/settings.controller.js';
import { AdminSettingsController } from './admin/settings.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [StorefrontSettingsController, AdminSettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
