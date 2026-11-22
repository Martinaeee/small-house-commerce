import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, tap, throwError, type Observable } from 'rxjs';
import { resolveRequestId } from '../../common/request-id.js';
import { ApiMetricsService, type ApiMetricSample } from './api-metrics.service.js';
import { routeGroupOf, sanitizedPath } from './api-metrics.js';

const PROBE_UA = 'LUWAG-Probe';

/**
 * Samples storefront API responses. It stamps `X-Request-Id` (so a browser
 * attempt can be traced) and only enqueues a sample; the write is asynchronous.
 * Non-storefront routes are skipped entirely.
 */
@Injectable()
export class ApiMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: ApiMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const rawPath = request.path ?? request.url ?? '';
    const group = routeGroupOf(rawPath);
    const userAgent = String(request.headers['user-agent'] ?? '');
    if (!group || userAgent.startsWith(PROBE_UA)) return next.handle();

    const requestId = resolveRequestId(request.headers['x-request-id']);
    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-Id', requestId);
    if (Math.random() >= this.metrics.sampleRate()) return next.handle();

    const started = performance.now();
    const finish = (status: number): void => {
      const sample: ApiMetricSample = {
        requestId,
        routeGroup: group,
        method: request.method ?? 'GET',
        path: sanitizedPath(rawPath),
        status,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        sampledAt: new Date(),
      };
      try {
        this.metrics.record(sample);
      } catch {
        // Collector failures must not change the business response.
      }
    };

    return next.handle().pipe(
      tap(() => finish(response.statusCode || 200)),
      catchError((error: unknown) => {
        finish(statusOf(error));
        return throwError(() => error);
      }),
    );
  }
}

function statusOf(error: unknown): number {
  const candidate = error as { getStatus?: () => number; status?: number; statusCode?: number };
  const status =
    typeof candidate?.getStatus === 'function'
      ? candidate.getStatus()
      : candidate?.status ?? candidate?.statusCode;
  return typeof status === 'number' && status >= 100 && status <= 599 ? status : 500;
}
