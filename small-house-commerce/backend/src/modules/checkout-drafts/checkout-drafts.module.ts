import { Module } from '@nestjs/common';
import { CheckoutDraftsService } from './checkout-drafts.service.js';
import { StorefrontCheckoutDraftsController } from './storefront/checkout-drafts.controller.js';

@Module({
  controllers: [StorefrontCheckoutDraftsController],
  providers: [CheckoutDraftsService],
  exports: [CheckoutDraftsService],
})
export class CheckoutDraftsModule {}
