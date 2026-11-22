import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiMetricsService, type ApiMetricSample } from './api-metrics.service.js';

afterEach(() => vi.unstubAllEnvs());

function sample(index: number): ApiMetricSample {
  return {
    requestId: `req-${index}`,
    routeGroup: 'product',
    method: 'GET',
    path: '/api/v1/storefront/products/x',
    status: 200,
    durationMs: 120,
    sampledAt: new Date('2026-11-20T10:00:00Z'),
  };
}

describe('ApiMetricsService buffer', () => {
  it('does nothing while collection is disabled', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'false');
    const prisma = { apiRequestMetric: { createMany: vi.fn(), deleteMany: vi.fn() } };
    const service = new ApiMetricsService(prisma as never);
    service.record(sample(0));
    await service.flush();
    expect(prisma.apiRequestMetric.createMany).not.toHaveBeenCalled();
  });

  it('writes one batch off the request path', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    const prisma = {
      apiRequestMetric: {
        createMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const service = new ApiMetricsService(prisma as never);
    service.record(sample(1));
    service.record(sample(2));
    await service.flush();
    expect(prisma.apiRequestMetric.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.apiRequestMetric.createMany.mock.calls[0][0].data).toHaveLength(2);
    await service.flush();
    expect(prisma.apiRequestMetric.createMany).toHaveBeenCalledTimes(1);
  });

  it('bounds the queue instead of growing without limit', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    const prisma = {
      apiRequestMetric: {
        createMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const service = new ApiMetricsService(prisma as never);
    for (let index = 0; index < 2_001; index += 1) service.record(sample(index));
    await service.flush();
    expect(prisma.apiRequestMetric.createMany.mock.calls[0][0].data).toHaveLength(2_000);
    expect(service.status().dropped).toBe(1);
  });

  it('does not count persisted samples as dropped when retention cleanup fails', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    const prisma = { apiRequestMetric: { createMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn(async () => { throw new Error('cleanup failed'); }) } };
    const service = new ApiMetricsService(prisma as never);
    service.record(sample(1));
    await service.flush();
    expect(service.status().dropped).toBe(0);
    expect(service.status().lastFlushAt).not.toBeNull();
  });

  it('keeps serving requests when the batch write fails', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    const prisma = {
      apiRequestMetric: {
        createMany: vi.fn(async () => {
          throw new Error('db paused');
        }),
        deleteMany: vi.fn(),
      },
    };
    const service = new ApiMetricsService(prisma as never);
    service.record(sample(1));
    await expect(service.flush()).resolves.toBeUndefined();
    await service.flush();
    expect(prisma.apiRequestMetric.createMany).toHaveBeenCalledTimes(1);
  });
});
