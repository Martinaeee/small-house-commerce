import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObservabilityService } from './observability.service.js';

afterEach(() => vi.unstubAllEnvs());

const NOW = new Date('2026-11-20T10:05:00.000Z');
const ALL = { id: 'admin', permissions: ['OBSERVABILITY_VIEW', 'MARKETING_VIEW_ALL'] };
const OWNER = { id: 'owner', permissions: ['OBSERVABILITY_VIEW'] };

function diagnosticsPrisma(overrides: { fail?: boolean } = {}) {
  return {
    $queryRaw: overrides.fail
      ? vi.fn(async () => {
          throw new Error('db paused');
        })
      : vi
          .fn()
          .mockResolvedValueOnce([
            {
              route_group: 'orders',
              requests: 120,
              p50: 320.4,
              p90: 780.2,
              p95: 1200.7,
              server_errors: 2,
              client_errors: 5,
              slow_requests: 3,
              last_at: new Date('2026-11-20T10:04:00Z'),
            },
          ])
          .mockResolvedValueOnce([
            { event_name: 'BEGIN_CHECKOUT', events: 60, sessions: 55 },
            { event_name: 'CHECKOUT_SUBMIT_ATTEMPT', events: 40, sessions: 36 },
            { event_name: 'CHECKOUT_SUBMIT_FAILED', events: 6, sessions: 6 },
            { event_name: 'PURCHASE', events: 30, sessions: 30 },
          ])
          .mockResolvedValueOnce([{ reason: 'STOCK', count: 4 }])
          .mockResolvedValueOnce([
            {
              request_id: 'req-abc',
              route_group: 'orders',
              method: 'POST',
              path: '/api/v1/storefront/orders',
              status: 500,
              duration_ms: 2400,
              sampled_at: new Date('2026-11-20T10:03:00Z'),
            },
          ]),
    apiRequestMetric: {
      findFirst: vi.fn(async () => ({ sampledAt: new Date('2026-11-20T10:04:30Z') })),
    },
  };
}

describe('P3 API diagnostics', () => {
  it('withholds platform-wide metrics from owner-scoped accounts without querying', async () => {
    const prisma = diagnosticsPrisma();
    const service = new ObservabilityService(prisma as never);
    const result = await service.apiDiagnostics(NOW, OWNER);
    expect(result.state).toBe('UNKNOWN');
    expect(result.routes).toEqual([]);
    expect(result.checkout.steps).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('maps route percentiles, the checkout chain, reasons and recent failures', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    vi.stubEnv('API_METRICS_SAMPLE_RATE', '1');
    const prisma = diagnosticsPrisma();
    const service = new ObservabilityService(prisma as never);
    const result = await service.apiDiagnostics(NOW, ALL);

    expect(result.collecting).toBe(true);
    expect(result.windowMinutes).toBe(1440);
    expect(result.routes[0]).toMatchObject({
      routeGroup: 'orders',
      requests: 120,
      p50Ms: 320.4,
      p95Ms: 1200.7,
      serverErrors: 2,
      budgetMs: 2000,
    });
    expect(result.checkout.steps.map((step) => [step.key, step.events])).toEqual([
      ['begin_checkout', 60],
      ['submit_attempt', 40],
      ['submit_failed', 6],
      ['purchase', 30],
    ]);
    expect(result.checkout.failureReasons).toEqual([{ reason: 'STOCK', count: 4 }]);
    expect(result.recentFailures[0]).toMatchObject({ requestId: 'req-abc', status: 500 });
    expect(result.lastSampleAt).toBe('2026-11-20T10:04:30.000Z');
  });

  it('reports an empty, non-asserting result when the query fails', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    const service = new ObservabilityService(diagnosticsPrisma({ fail: true }) as never);
    const result = await service.apiDiagnostics(NOW, ALL);
    expect(result.routes).toEqual([]);
    expect(result.recentFailures).toEqual([]);
    expect(result.state).toBe('UNKNOWN');
    expect(result.checkout.steps).toEqual([]);
  });
});

describe('P3 request id correlation', () => {
  function tracePrisma(options: {
    server?: Record<string, unknown> | null;
    events?: Array<Record<string, unknown>>;
  }) {
    return {
      apiRequestMetric: {
        findFirst: vi.fn(async () => options.server ?? null),
      },
      $queryRaw: vi.fn(async () => options.events ?? []),
    };
  }

  it('correlates the server sample with the browser attempt', async () => {
    vi.stubEnv('API_METRICS_SAMPLE_RATE', '1');
    const service = new ObservabilityService(
      tracePrisma({
        server: {
          method: 'POST',
          path: '/api/v1/storefront/orders',
          routeGroup: 'orders',
          status: 500,
          durationMs: 2400,
          sampledAt: new Date('2026-11-20T10:03:00Z'),
        },
        events: [
          {
            event_name: 'CHECKOUT_SUBMIT_FAILED',
            created_at: new Date('2026-11-20T10:03:01Z'),
            reason: 'SERVER',
            http_status: 500,
          },
        ],
      }) as never,
    );
    const result = await service.requestTrace('req-abc', NOW, ALL);
    expect(result.correlation).toBe('CORRELATED');
    expect(result.server?.status).toBe(500);
    expect(result.browser.failureReason).toBe('SERVER');
  });

  it('keeps a network failure without a server sample UNKNOWN', async () => {
    const service = new ObservabilityService(
      tracePrisma({
        events: [
          {
            event_name: 'CHECKOUT_SUBMIT_FAILED',
            created_at: new Date('2026-11-20T10:03:01Z'),
            reason: 'NETWORK',
            http_status: null,
          },
        ],
      }) as never,
    );
    const result = await service.requestTrace('req-abc', NOW, ALL);
    expect(result.correlation).toBe('UNKNOWN');
  });

  it('treats a non-network browser failure without a server sample as SERVER_LOG_MISSING', async () => {
    const service = new ObservabilityService(
      tracePrisma({
        events: [
          {
            event_name: 'CHECKOUT_SUBMIT_FAILED',
            created_at: new Date('2026-11-20T10:03:01Z'),
            reason: 'SERVER',
            http_status: 500,
          },
        ],
      }) as never,
    );
    const result = await service.requestTrace('req-abc', NOW, ALL);
    expect(result.correlation).toBe('SERVER_LOG_MISSING');
  });

  it('does not claim the server sample was dropped when it exists', async () => {
    vi.stubEnv('API_METRICS_SAMPLE_RATE', '0.5');
    const service = new ObservabilityService(
      tracePrisma({
        server: {
          method: 'GET',
          path: '/api/v1/storefront/products/x',
          routeGroup: 'product',
          status: 200,
          durationMs: 180,
          sampledAt: new Date('2026-11-20T10:03:00Z'),
        },
      }) as never,
    );
    const result = await service.requestTrace('req-abc', NOW, ALL);
    expect(result.correlation).toBe('UNKNOWN');
  });

  it('stays UNKNOWN when neither side has evidence', async () => {
    const service = new ObservabilityService(tracePrisma({}) as never);
    const result = await service.requestTrace('req-abc', NOW, ALL);
    expect(result.correlation).toBe('UNKNOWN');
    expect(result.server).toBeNull();
  });
});
