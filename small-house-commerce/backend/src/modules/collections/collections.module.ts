import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CollectionsService } from './collections.service.js';
import { StorefrontCollectionsController } from './storefront/collections.controller.js';
import { AdminCollectionsController } from './admin/collections.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [StorefrontCollectionsController, AdminCollectionsController],
  providers: [CollectionsService],
})
export class CollectionsModule {}
