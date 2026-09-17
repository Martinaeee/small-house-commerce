import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AdminHomepageController } from './admin/homepage.controller.js';
import { HomepageService } from './homepage.service.js';
import { StorefrontHomepageController } from './storefront/homepage.controller.js';

@Module({
  // AuthModule for JWT guards; CatalogModule exports ProductsService (shared
  // sellability/rating pipeline).
  imports: [AuthModule, CatalogModule],
  controllers: [StorefrontHomepageController, AdminHomepageController],
  providers: [HomepageService],
})
export class CmsModule {}
