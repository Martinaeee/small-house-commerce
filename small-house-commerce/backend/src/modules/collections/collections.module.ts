import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CollectionsService } from './collections.service.js';
import { StorefrontCollectionsController } from './storefront/collections.controller.js';
import { AdminCollectionsController } from './admin/collections.controller.js';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [StorefrontCollectionsController, AdminCollectionsController],
  providers: [CollectionsService],
})
export class CollectionsModule {}
