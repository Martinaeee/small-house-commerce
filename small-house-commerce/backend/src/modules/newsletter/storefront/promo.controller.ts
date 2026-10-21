import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { PromotionService } from '../promotion.service.js';
import {
  promoPreviewSchema,
  type PromoPreviewInput,
} from '../dto/newsletter.dto.js';

/**
 * Display-only promo preview for the checkout and PDP forms. The result is not
 * authoritative: the discount is recomputed server-side when the order is
 * created, and this endpoint claims no usage slot.
 */
@Controller('storefront/checkout/promo-code')
export class StorefrontPromoController {
  constructor(private readonly promotions: PromotionService) {}

  @Post('preview')
  @HttpCode(200)
  @UseGuards(ThrottleGuard)
  @Throttle({
    key: 'promo-preview:ip',
    bucket: 'ip',
    limit: 60,
    windowMs: 10 * 60_000,
  })
  preview(
    @Body(new ZodValidationPipe(promoPreviewSchema)) body: PromoPreviewInput,
  ) {
    return this.promotions.preview(body.code, body.subtotal);
  }
}
