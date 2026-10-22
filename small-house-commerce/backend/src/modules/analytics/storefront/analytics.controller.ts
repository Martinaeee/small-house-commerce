import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AnalyticsService } from '../analytics.service.js';
import {
  analyticsBatchSchema,
  type AnalyticsBatchInput,
} from '../dto/analytics-event.dto.js';

/**
 * Public storefront event sink (dashboard §18). No guard: the payload carries
 * no identity and every field is bounded. Oversized batches are refused by the
 * DTO, floods by the service's per-address bucket.
 */
@Controller('storefront/events')
export class StorefrontAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(
    @Body(new ZodValidationPipe(analyticsBatchSchema)) input: AnalyticsBatchInput,
    @Req() request: Request,
  ) {
    const clientKey =
      request.ip ?? request.socket.remoteAddress ?? 'unknown';
    if (this.analytics.isRateLimited(clientKey)) {
      throw new HttpException('Too many events', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.analytics.ingest(input.events, clientKey);
  }
}
