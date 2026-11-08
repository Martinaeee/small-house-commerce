import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { MarketingTouchService } from '../marketing-touch.service.js';
import { marketingTouchSchema, type MarketingTouchInput } from '../dto/marketing-touch.dto.js';
import {
  MARKETING_FIRST_COOKIE,
  MARKETING_LAST_COOKIE,
  readCookie,
  requestIsSecure,
} from '../marketing-touch-cookies.js';

@Controller('storefront/marketing-touch')
export class StorefrontMarketingTouchController {
  constructor(@Inject(MarketingTouchService) private readonly touches: MarketingTouchService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async touch(
    @Body(new ZodValidationPipe(marketingTouchSchema)) input: MarketingTouchInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.touches.touch(input);
    if (result.credential && result.expiresAt) {
      const maxAge = Math.max(0, Date.parse(result.expiresAt) - Date.now());
      const options = {
        httpOnly: true,
        secure: requestIsSecure(request),
        sameSite: 'lax' as const,
        path: '/',
        maxAge,
      };
      if (!readCookie(request.headers.cookie, MARKETING_FIRST_COOKIE)) {
        response.cookie(MARKETING_FIRST_COOKIE, result.credential, options);
      }
      if (result.paid) response.cookie(MARKETING_LAST_COOKIE, result.credential, options);
    }
    return result;
  }
}