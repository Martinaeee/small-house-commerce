import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AdminStorefrontShellController } from './admin/storefront-shell.controller.js';
import { StorefrontShellAssetsService } from './storefront-shell-assets.service.js';
import { StorefrontShellService } from './storefront-shell.service.js';
import { StorefrontShellController } from './storefront/storefront-shell.controller.js';

@Module({
  imports: [AuthModule, UploadsModule, SettingsModule],
  controllers: [AdminStorefrontShellController, StorefrontShellController],
  providers: [StorefrontShellService, StorefrontShellAssetsService],
  exports: [StorefrontShellService],
})
export class StorefrontShellModule {}
