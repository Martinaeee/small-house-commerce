import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { NewsletterService } from './newsletter.service.js';
import { PromotionService } from './promotion.service.js';
import { StorefrontNewsletterController } from './storefront/newsletter.controller.js';
import { StorefrontPromoController } from './storefront/promo.controller.js';
import { AdminSubscribersController } from './admin/subscribers.controller.js';
import { AdminPromotionsController } from './admin/promotions.controller.js';

@Module({
  imports: [AuthModule, EmailModule, SettingsModule],
  controllers: [
    StorefrontNewsletterController,
    StorefrontPromoController,
    AdminSubscribersController,
    AdminPromotionsController,
  ],
  providers: [NewsletterService, PromotionService],
  exports: [NewsletterService, PromotionService],
})
export class NewsletterModule {}
