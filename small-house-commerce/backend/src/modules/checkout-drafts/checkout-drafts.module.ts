import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminCheckoutDraftsController } from './admin/checkout-drafts.controller.js';
import { CheckoutDraftsCleanup } from './checkout-drafts-cleanup.js';
import { CheckoutDraftsService } from './checkout-drafts.service.js';
import { StorefrontCheckoutDraftsController } from './storefront/checkout-drafts.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [StorefrontCheckoutDraftsController, AdminCheckoutDraftsController],
  providers: [CheckoutDraftsService, CheckoutDraftsCleanup],
  exports: [CheckoutDraftsService],
})
export class CheckoutDraftsModule {}
