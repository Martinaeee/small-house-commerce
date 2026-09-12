import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { SlidingWindowRateLimiter, normalizeClientIp } from './rate-limit.window.js';

export const THROTTLE_KEY = 'throttle:policies';

export type ThrottleBucket = 'ip' | 'email';

export interface ThrottlePolicy {
  /** Bucket namespace including route and dimension, e.g. 'admin-login:ip'. */
  key: string;
  bucket: ThrottleBucket;
  limit: number;
  windowMs: number;
}

/** Declares one or more rate-limit policies for a route; read by ThrottleGuard. */
export const Throttle = (...policies: ThrottlePolicy[]) =>
  SetMetadata(THROTTLE_KEY, policies);

type ThrottledRequest = Request & { body?: unknown };

/**
 * In-process sliding-window throttle applied per route with @UseGuards.
 * Every guard instance owns its limiter; policy keys are route-specific so
 * the two modules' guards never share a bucket by accident.
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly limiter = new SlidingWindowRateLimiter();

  // Reflector is provided by Nest core; the default keeps `new ThrottleGuard()`
  // working in unit tests.
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): boolean {
    const policies = this.reflector.getAllAndOverride<ThrottlePolicy[]>(
      THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!policies || policies.length === 0) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<ThrottledRequest>();
    const response = http.getResponse<Response>();

    const ip = normalizeClientIp(request.ip);
    const email = emailFromBody(request.body);
    const now = Date.now();

    let blocked = false;
    let retryAfterMs = 0;

    for (const policy of policies) {
      const subject = policy.bucket === 'email' ? email : ip;
      // Malformed/absent body: the IP dimension still protects the route.
      if (policy.bucket === 'email' && subject === null) {
        continue;
      }
      const decision = this.limiter.hit(
        `${policy.key}:${subject}`,
        policy.limit,
        policy.windowMs,
        now,
      );
      if (!decision.allowed) {
        blocked = true;
        retryAfterMs =
          retryAfterMs === 0 ? decision.retryAfterMs : Math.min(retryAfterMs, decision.retryAfterMs);
      }
    }

    if (blocked) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

function emailFromBody(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const candidate = (body as Record<string, unknown>).email;
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toLowerCase();
      if (normalized.length > 0 && normalized.length <= 254) {
        return normalized;
      }
    }
  }
  return null;
}
