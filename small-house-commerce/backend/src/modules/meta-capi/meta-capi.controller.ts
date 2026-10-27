import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import {
  metaEventSchema,
  type MetaEventInput,
} from './dto/meta-event.dto.js';
import { MetaCapiService } from './meta-capi.service.js';

/**
 * Public storefront sink for consented commerce events. It only queues a
 * server-side copy of an event the browser Pixel already sent with the same
 * event id; the response never reveals delivery state.
 */
@Controller('storefront/meta-events')
export class StorefrontMetaEventsController {
  constructor(private readonly metaCapi: MetaCapiService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(
    @Body(new ZodValidationPipe(metaEventSchema)) input: MetaEventInput,
    @Req() request: Request,
  ) {
    if (!input.consent) return { accepted: false };
    const clientKey = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    if (!this.metaCapi.takeRateLimitToken(clientKey)) {
      throw new HttpException('Too many events', HttpStatus.TOO_MANY_REQUESTS);
    }
    const userAgent = request.headers['user-agent'];
    const accepted = await this.metaCapi.enqueue({
      eventName: input.name,
      eventId: input.eventId,
      eventSourceUrl: input.eventSourceUrl,
      customData: input.customData,
      fbp: input.fbp ?? null,
      fbc: input.fbc ?? null,
      clientIp: request.ip ?? null,
      clientUserAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    });
    return { accepted };
  }
}

/** Read-only queue health for the admin status page. */
@Controller('admin/meta-capi')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class AdminMetaCapiController {
  constructor(private readonly metaCapi: MetaCapiService) {}

  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  status() {
    return this.metaCapi.health();
  }
}
