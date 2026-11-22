import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObservabilityService } from './observability.service.js';

const NOW = new Date('2026-11-13T10:00:00.000Z');
const CHECKED = new Date('2026-11-13T09:59:42.000Z');

function probeRun(
  routeKey: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `id-${routeKey}`,
    runId: 'run-1',
    environment: 'PROD',
    routeKey,
    routePath: `/${routeKey}`,
    status,
    dns: 'PASS',
    tls: 'PASS',
    http: 'PASS',
    httpStatus: 200,
    latencyMs: 182,
    dom: 'PASS',
    errorCode: null,
    checkedAt: CHECKED,
    createdAt: CHECKED,
    ...overrides,
  };
}

function prismaMock(options: {
  latest?: ReturnType<typeof probeRun>[];
  uptime?: Array<{ day: string; total: number; ok: number }>;
  failures?: Array<{
    route_key: string;
    environment: string;
    checked_at: Date;
    http_status: number | null;
    latency_ms: number | null;
    error_code: string | null;
    recovered_at: Date | null;
  }>;
  prod?: ReturnType<typeof probeRun> | null;
  external?: ReturnType<typeof probeRun> | null;
  heartbeat?: { reportedAt: Date } | null;
}) {
  const latest = options.latest ?? [];
  let rawCall = 0;
  return {
    syntheticProbeRun: {
      findMany: vi.fn(async (args: { take?: number } | undefined) =>
        args?.take === 8 ? latest.slice(0, 8) : latest,
      ),
      findFirst: vi.fn(async (args: { where: { environment: string } }) =>
        args.where.environment === 'PROD'
          ? (options.prod ?? null)
          : (options.external ?? null),
      ),
    },
    probeNodeHeartbeat: {
      findFirst: vi.fn(async () => options.heartbeat ?? null),
    },
    $queryRaw: vi.fn(async () => {
      rawCall += 1;
      return rawCall === 1 ? (options.uptime ?? []) : (options.failures ?? []);
    }),
  };
}

const allRoutes = ['home', 'collections', 'product', 'cart', 'checkout'];

describe('ObservabilityService availability (P1.5)', () => {
  beforeEach(() => {
    vi.stubEnv('PROBE_PRODUCT_PATH', '/products/example');
    vi.stubEnv('PROBE_EXTERNAL_ENABLED', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('turns a fully passing round green with real route evidence', async () => {
    const latest = allRoutes.map((key) => probeRun(key, 'OPERATIONAL'));
    const prisma = prismaMock({
      latest,
      uptime: [{ day: '2026-11-13', total: 5, ok: 5 }],
      prod: latest[0],
    });
    const service = new ObservabilityService(prisma as never);
    const result = await service.availability(NOW);

    expect(result.status).toBe('OPERATIONAL');
    expect(result.reason).toMatch(/All 5 key routes passed/);
    expect(result.routes).toHaveLength(5);
    expect(result.routes[0]).toMatchObject({
      key: 'home',
      status: 'OPERATIONAL',
      dns: 'PASS',
      httpStatus: 200,
      latencyMs: 182,
    });
    expect(result.uptime7d.at(-1)).toMatchObject({
      day: '2026-11-13',
      state: 'OK',
      uptimePct: 100,
    });
    expect(result.nodes[0]).toMatchObject({ key: 'prod', state: 'ONLINE' });
    expect(result.edge).toBeNull();
  });

  it('keeps an empty probe store UNKNOWN with NO DATA uptime', async () => {
    const prisma = prismaMock({});
    const service = new ObservabilityService(prisma as never);
    const result = await service.availability(NOW);

    expect(result.status).toBe('UNKNOWN');
    expect(result.routes).toHaveLength(5);
    expect(result.routes.every((route) => route.status === 'UNKNOWN')).toBe(true);
    expect(result.uptime7d.at(-1)).toMatchObject({ state: 'NO_DATA', uptimePct: null });
    expect(result.nodes[0]).toMatchObject({ key: 'prod', state: 'OFFLINE', lastHeartbeatAt: null });
  });

  it('raises the overall state on a real probe failure', async () => {
    const latest = [
      probeRun('home', 'OPERATIONAL'),
      probeRun('collections', 'OPERATIONAL'),
      probeRun('product', 'DOWN', { http: 'FAIL', httpStatus: 502 }),
      probeRun('cart', 'OPERATIONAL'),
      probeRun('checkout', 'OPERATIONAL'),
    ];
    const prisma = prismaMock({
      latest,
      uptime: [{ day: '2026-11-13', total: 5, ok: 4 }],
      failures: [
        {
          route_key: 'product',
          environment: 'PROD',
          checked_at: new Date('2026-11-13T09:30:00.000Z'),
          http_status: 502,
          latency_ms: 320,
          error_code: 'HTTP_502',
          recovered_at: new Date('2026-11-13T09:32:00.000Z'),
        },
      ],
      prod: latest[0],
    });
    const service = new ObservabilityService(prisma as never);
    const result = await service.availability(NOW);

    expect(result.status).toBe('DOWN');
    expect(result.reason).toMatch(/1 of 5 key routes are down/);
    expect(result.recentFailures[0]).toMatchObject({
      route: '/products/example',
      httpStatus: 502,
      recoveredAt: '2026-11-13T09:32:00.000Z',
    });
  });

  it('withholds EXTERNAL node evidence until it is enabled or has runs', async () => {
    const latest = allRoutes.map((key) => probeRun(key, 'OPERATIONAL'));
    const prisma = prismaMock({ latest, prod: latest[0], external: null });
    const service = new ObservabilityService(prisma as never);
    vi.stubEnv('PROBE_EXTERNAL_ENABLED', 'true');
    const result = await service.availability(NOW);
    expect(result.nodes.map((node) => node.key)).toEqual(['prod', 'external']);
    expect(result.nodes[1].state).toBe('OFFLINE');
  });
});
