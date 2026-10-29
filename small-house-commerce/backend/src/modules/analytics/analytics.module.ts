import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AnalyticsService } from './analytics.service.js';
import { StorefrontAnalyticsController } from './storefront/analytics.controller.js';

@Module({
  // CatalogModule exports MarketingTouchService: the analytics ingest verifies
  // the signed touch credential the browser attaches to each event batch and
  // stores only the resolved campaign link id.
  imports: [CatalogModule],
  controllers: [StorefrontAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
