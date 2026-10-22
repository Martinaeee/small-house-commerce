import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { StorefrontAnalyticsController } from './storefront/analytics.controller.js';

@Module({
  controllers: [StorefrontAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
