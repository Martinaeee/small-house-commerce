import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MarketingGuard } from '../marketing/marketing.guard.js';
import { AdminShortLinksController } from './admin/short-links.controller.js';
import { ShortLinksService } from './short-links.service.js';
import { StorefrontShortLinksController } from './storefront/short-links.controller.js';

@Module({
  // AuthModule exports JwtModule and JwtAuthGuard, which both the guard chain
  // and the marketing guard depend on.
  imports: [AuthModule],
  controllers: [AdminShortLinksController, StorefrontShortLinksController],
  providers: [ShortLinksService, MarketingGuard],
})
export class ShortLinksModule {}
