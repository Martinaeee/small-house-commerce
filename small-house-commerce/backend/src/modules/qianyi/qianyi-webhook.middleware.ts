import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { QianyiWebhookService } from './qianyi-webhook.service.js';

const MAX_BODY_BYTES = 200_000;

/**
 * Runs before the route's Multipart interceptor, so an unauthenticated caller
 * cannot make us parse an unbounded multipart body. JSON and urlencoded
 * bodies are already parsed by Nest's global parser (its 100KB limit applies);
 * that parser cost cannot be moved without replacing it application-wide.
 */
@Injectable()
export class QianyiWebhookMiddleware implements NestMiddleware {
  constructor(private readonly webhooks: QianyiWebhookService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (!this.webhooks.allow(request.ip ?? 'unknown')) {
      response.status(429).json({ ok: false });
      return;
    }
    const declared = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      response.status(413).json({ ok: false });
      return;
    }
    next();
  }
}
