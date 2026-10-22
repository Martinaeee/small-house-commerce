import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AdminDashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  // CatalogModule supplies MarketingReportService, so campaign cards use the
  // same visit/order/conversion arithmetic as the marketing report itself.
  imports: [AuthModule, CatalogModule],
  controllers: [AdminDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
