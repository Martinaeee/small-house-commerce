import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { resolveRequestId } from '../../common/request-id.js';
import { ApiMetricsInterceptor } from './api-metrics.interceptor.js';
import type { ApiMetricsService } from './api-metrics.service.js';

function contextFor(path: string, status = 200) {
  const request = { path, url: path, method: 'GET', headers: {} as Record<string, string> };
  const response = {
    statusCode: status,
    getHeader: vi.fn(() => undefined),
    setHeader: vi.fn(),
  };
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext,
    request,
    response,
  };
}

describe('ApiMetricsInterceptor', () => {
  it('uses the same generated id in the controller, response and metric', async () => {
    const record = vi.fn();
    const metrics = { enabled: () => true, sampleRate: () => 1, record } as unknown as ApiMetricsService;
    const { context, request, response } = contextFor('/api/v1/storefront/orders');
    await firstValueFrom(new ApiMetricsInterceptor(metrics).intercept(context, {
      handle: () => {
        const id = resolveRequestId(request.headers['x-request-id']);
        response.setHeader('X-Request-Id', id);
        return of('ok');
      },
    }));
    expect(record.mock.calls[0][0].requestId).toBe(response.setHeader.mock.lastCall?.[1]);
  });

  it('cannot turn a successful request into an error if recording fails', async () => {
    const metrics = { enabled: () => true, sampleRate: () => 1, record: () => { throw new Error('collector failed'); } } as unknown as ApiMetricsService;
    const { context } = contextFor('/api/v1/storefront/products/x');
    await expect(firstValueFrom(new ApiMetricsInterceptor(metrics).intercept(context, { handle: () => of('ok') }))).resolves.toBe('ok');
  });
  it('records a storefront sample and stamps the request id', async () => {
    const metrics = { sampleRate: () => 1, record: vi.fn() } as unknown as ApiMetricsService;
    const { context, response } = contextFor('/api/v1/storefront/products/x');
    const interceptor = new ApiMetricsInterceptor(metrics);
    await firstValueFrom(
      interceptor.intercept(context, { handle: () => of('ok') } as CallHandler),
    );
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ routeGroup: 'product', status: 200, method: 'GET' }),
    );
  });

  it('does not sample admin routes', async () => {
    const metrics = { sampleRate: () => 1, record: vi.fn() } as unknown as ApiMetricsService;
    const { context } = contextFor('/api/v1/admin/observability/api');
    const interceptor = new ApiMetricsInterceptor(metrics);
    await firstValueFrom(
      interceptor.intercept(context, { handle: () => of('ok') } as CallHandler),
    );
    expect(metrics.record).not.toHaveBeenCalled();
  });

  it('records the failure status and rethrows the original error', async () => {
    const metrics = { sampleRate: () => 1, record: vi.fn() } as unknown as ApiMetricsService;
    const { context } = contextFor('/api/v1/storefront/orders');
    const interceptor = new ApiMetricsInterceptor(metrics);
    const error = { getStatus: () => 502 };
    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => error),
        } as CallHandler),
      ),
    ).rejects.toBe(error);
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ routeGroup: 'orders', status: 502 }),
    );
  });

  it('honours sampling', async () => {
    const metrics = { sampleRate: () => 0, record: vi.fn() } as unknown as ApiMetricsService;
    const { context } = contextFor('/api/v1/storefront/cart/items');
    const interceptor = new ApiMetricsInterceptor(metrics);
    await firstValueFrom(
      interceptor.intercept(context, { handle: () => of('ok') } as CallHandler),
    );
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
