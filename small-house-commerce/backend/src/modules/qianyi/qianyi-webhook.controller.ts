import { Controller, HttpCode, HttpException, HttpStatus, Post, Req, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { QianyiWebhookService } from './qianyi-webhook.service.js';

/**
 * Public callback sink.
 *
 * Qianyi posts `multipart/form-data` by default (text fields only). The global
 * Nest/Express parser covers urlencoded/JSON; this interceptor only adds
 * multipart field parsing. A missing route-level body limit is a known
 * residual risk recorded in the gate report.
 */
@Controller('qianyi')
export class QianyiWebhookController {
  constructor(private readonly webhooks: QianyiWebhookService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 1, fields: 5, fieldSize: 65_536 } }))
  async receive(@Req() request: Request) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const field = (name: string): string => (typeof body[name] === 'string' ? body[name] as string : '');
    const result = await this.webhooks.ingest({
      appId: field('appId'),
      serviceType: field('serviceType'),
      bizParam: field('bizParam'),
      timestamp: field('timestamp'),
      sign: field('sign'),
    });
    if (result.retryable) {
      // Qianyi resends on a non-2xx; the archived row keeps the failure.
      throw new HttpException('dispatch failed, retry', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    // Signed callbacks are always acknowledged, including while the feature is
    // disabled (they are deferred, not applied) and ones we rejected.
    return result.deferred ? { ok: true, deferred: true } : { ok: result.ok };
  }
}
