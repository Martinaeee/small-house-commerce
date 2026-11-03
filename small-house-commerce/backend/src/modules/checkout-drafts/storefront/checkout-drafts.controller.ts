import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CheckoutDraftCapacityError, CheckoutDraftsService } from '../checkout-drafts.service.js';
import {
  checkoutDraftSaveSchema,
  type CheckoutDraftSaveInput,
} from '../dto/checkout-draft.dto.js';

const HEADER = 'x-checkout-draft-token';

function requireToken(token: string | undefined): string {
  if (!token || token.trim() === '') {
    throw new BadRequestException('The checkout draft token header is required.');
  }
  return token.trim();
}

@Controller('storefront/checkout-drafts')
@UseGuards(ThrottleGuard)
export class StorefrontCheckoutDraftsController {
  constructor(private readonly drafts: CheckoutDraftsService) {}

  @Put('current')
  @HttpCode(200)
  @Throttle({ key: 'checkout-draft-save:ip', bucket: 'ip', limit: 120, windowMs: 60_000 })
  async save(
    @Headers(HEADER) token: string | undefined,
    @Body(new ZodValidationPipe(checkoutDraftSaveSchema)) body: CheckoutDraftSaveInput,
    @Req() request?: Request,
    @Res({ passthrough: true }) response?: Response,
  ) {
    try {
      return await this.drafts.save(requireToken(token), body, undefined, request?.ip);
    } catch (error) {
      if (error instanceof CheckoutDraftCapacityError) {
        response?.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Get('current')
  @Throttle({ key: 'checkout-draft-read:ip', bucket: 'ip', limit: 240, windowMs: 60_000 })
  async read(@Headers(HEADER) token: string | undefined) {
    const draft = await this.drafts.read(requireToken(token));
    if (!draft) {
      throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
    }
    return draft;
  }
}
