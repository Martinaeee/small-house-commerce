import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from './alert.service.js';

const NOW = new Date('2026-11-14T10:00:10.000Z');

function run(routeKey: string, status: string, checkedAt: Date) {
  return {
    id: `${routeKey}-${checkedAt.getTime()}`,
    runId: `run-${checkedAt.getTime()}`,
    environment: 'PROD',
    routeKey,
    routePath: `/${routeKey}`,
    status,
    dns: 'PASS',
    tls: 'PASS',
    http: status === 'DOWN' ? 'FAIL' : 'PASS',
    httpStatus: status === 'DOWN' ? 502 : 200,
    latencyMs: 200,
    dom: 'PASS',
    errorCode: status === 'DOWN' ? 'HTTP_502' : null,
    checkedAt,
    createdAt: checkedAt,
  };
}

function prismaMock(options: {
  runs?: ReturnType<typeof run>[];
  latest?: ReturnType<typeof run> | null;
  existing?: Record<string, unknown> | null;
} = {}) {
  return {
    $queryRaw: vi.fn(async () => []),
    syntheticProbeRun: {
      findMany: vi.fn(async () => options.runs ?? []),
      findFirst: vi.fn(async () => options.latest ?? null),
    },
    alertIssue: {
      findUnique: vi.fn(async () => options.existing ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'issue-1',
        occurrences: 1,
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'issue-1', ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

function writeAccessReport(path: string, generatedAt: Date, pdpBad: boolean) {
  writeFileSync(
    path,
    JSON.stringify({
      generatedAt: generatedAt.toISOString(),
      errors: pdpBad
        ? [{ code: 502, path: '/products/example', count: 1, lastAt: generatedAt.toISOString() }]
        : [],
      slowest: pdpBad
        ? [{ ms: 4200, uri: '/products/example', status: 200 }]
        : [],
    }),
  );
}

describe('AlertService P2-lite', () => {
  let dir: string;
  let accessPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'p2lite-alert-'));
    accessPath = join(dir, 'access.json');
    vi.stubEnv('SYSTEM_ACCESS_FILE', accessPath);
    vi.stubEnv('ALERT_ENABLED', 'false');
    vi.stubEnv('PROBE_ENABLED', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('alerts only after two consecutive PDP bad reports', async () => {
    const prisma = prismaMock();
    const notifier = { send: vi.fn(async () => undefined) };
    const service = new AlertService(prisma as never, notifier as never);

    writeAccessReport(accessPath, new Date('2026-11-14T09:55:00Z'), true);
    await service.evaluateAll(NOW);
    expect(prisma.alertIssue.create).not.toHaveBeenCalled();

    writeAccessReport(accessPath, new Date('2026-11-14T10:00:00Z'), true);
    await service.evaluateAll(NOW);
    expect(prisma.alertIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ruleCode: 'PDP_5XX_TIMEOUT',
        severity: 'P1',
        status: 'OPEN',
        fingerprint: 'PDP_5XX_TIMEOUT',
      }),
    });
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('closes the PDP issue when the next report is clean', async () => {
    const prisma = prismaMock();
    const service = new AlertService(prisma as never, { send: vi.fn() } as never);
    writeAccessReport(accessPath, new Date('2026-11-14T09:55:00Z'), true);
    await service.evaluateAll(NOW);
    writeAccessReport(accessPath, new Date('2026-11-14T10:00:00Z'), true);
    await service.evaluateAll(NOW);

    writeAccessReport(accessPath, new Date('2026-11-14T10:05:00Z'), false);
    await service.evaluateAll(new Date('2026-11-14T10:05:10Z'));
    expect(prisma.alertIssue.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ruleCode: 'PDP_5XX_TIMEOUT',
        fingerprint: 'PDP_5XX_TIMEOUT',
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      }),
      data: expect.objectContaining({ status: 'CLOSED' }),
    });
  });

  it('alerts when a route is DOWN for two consecutive rounds', async () => {
    const runs = [
      run('product', 'DOWN', new Date('2026-11-14T09:59:40Z')),
      run('product', 'DOWN', new Date('2026-11-14T09:58:40Z')),
    ];
    const prisma = prismaMock({ runs });
    const service = new AlertService(prisma as never, { send: vi.fn() } as never);
    await service.evaluateAll(NOW);
    expect(prisma.alertIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ruleCode: 'PROBE_DOWN',
        fingerprint: 'PROBE_DOWN:product',
        severity: 'P0',
      }),
    });
  });

  it('alerts when probe evidence goes stale', async () => {
    vi.stubEnv('PROBE_ENABLED', 'true');
    const prisma = prismaMock({ latest: null });
    const service = new AlertService(prisma as never, { send: vi.fn() } as never);
    await service.evaluateAll(new Date(Date.now() + 5 * 60_000));
    expect(prisma.alertIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ruleCode: 'PROBE_STALE', severity: 'P1' }),
    });
  });

  it('keeps an existing issue open when access evidence is unavailable', async () => {
    const prisma = prismaMock({
      existing: { id: 'issue-1', status: 'OPEN', ruleCode: 'PDP_5XX_TIMEOUT', fingerprint: 'PDP_5XX_TIMEOUT' },
    });
    const service = new AlertService(prisma as never, { send: vi.fn() } as never);
    // No access file written: unavailable must not resolve an open issue.
    await service.evaluateAll(NOW);
    expect(prisma.alertIssue.updateMany).not.toHaveBeenCalledWith({
      where: expect.objectContaining({ ruleCode: 'PDP_5XX_TIMEOUT' }),
      data: expect.objectContaining({ status: 'CLOSED' }),
    });
  });

  it('alerts when PDP product p95 exceeds 2s in two completed windows', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    const prisma = prismaMock();
    prisma.$queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ n: 40, p95: 2600 }])
      .mockResolvedValueOnce([{ n: 35, p95: 3100 }]);
    const service = new AlertService(prisma as never, { send: vi.fn() } as never);
    await service.evaluateAll(NOW);
    expect(prisma.alertIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ruleCode: 'PDP_P95_SLOW',
        fingerprint: 'PDP_P95_SLOW:product',
        severity: 'P1',
      }),
    });
  });

  it('does not alert on a low-sample PDP window', async () => {
    vi.stubEnv('API_METRICS_ENABLED', 'true');
    const prisma = prismaMock();
    prisma.$queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ n: 10, p95: 5000 }])
      .mockResolvedValueOnce([{ n: 12, p95: 6000 }]);
    const service = new AlertService(prisma as never, { send: vi.fn() } as never);
    await service.evaluateAll(NOW);
    expect(prisma.alertIssue.create).not.toHaveBeenCalled();
    expect(prisma.alertIssue.updateMany).not.toHaveBeenCalledWith({
      where: expect.objectContaining({ ruleCode: 'PDP_P95_SLOW' }),
      data: expect.objectContaining({ status: 'CLOSED' }),
    });
  });
});
