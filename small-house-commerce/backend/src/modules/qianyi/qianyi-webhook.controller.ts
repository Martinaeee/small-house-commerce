import { Controller, HttpCode, HttpStatus, Post, Req, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { QianyiWebhookService } from './qianyi-webhook.service.js';

/**
 * Public callback sink.
 *
 * Qianyi posts `multipart/form-data` by default (only text fields, no files),
 * so the interceptor turns the parts into a normal `req.body`; Express' own
 * parser already covers the form-urlencoded variant.
 */
@Controller('qianyi')
export class QianyiWebhookController {
  constructor(private readonly webhooks: QianyiWebhookService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 1, fields: 20, fieldSize: 65_536 } }))
  async receive(@Req() request: Request) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const field = (name: string): string => {
      const value = body[name];
      return typeof value === 'string' ? value : '';
    };
    const result = await this.webhooks.ingest({
      appId: field('appId'),
      serviceType: field('serviceType'),
      bizParam: field('bizParam'),
      timestamp: field('timestamp'),
      sign: field('sign'),
    });
    // Always 200 unless the signature is wrong: Qianyi retries on failure.
    return { ok: result.ok };
  }
}
