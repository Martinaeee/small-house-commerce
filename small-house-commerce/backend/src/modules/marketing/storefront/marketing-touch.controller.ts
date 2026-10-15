import { Body, Controller, Header, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { MarketingTouchService } from '../marketing-touch.service.js';
import { marketingTouchSchema, type MarketingTouchInput } from '../dto/marketing-touch.dto.js';

@Controller('storefront/marketing-touch')
export class StorefrontMarketingTouchController {
  constructor(@Inject(MarketingTouchService) private readonly touches: MarketingTouchService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  touch(@Body(new ZodValidationPipe(marketingTouchSchema)) input: MarketingTouchInput) {
    return this.touches.touch(input);
  }
}
