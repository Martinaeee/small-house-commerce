import { describe, expect, it, vi } from 'vitest';
import { ObservabilityService } from './observability.service.js';

function prismaMock(row: { last: Date | null; count: number } | Error) {
  return {
    $queryRaw: vi.fn(async () => {
      if (row instanceof Error) throw row;
      return [{ last: row.last, count: row.count }];
    }),
  };
}

const NOW = new Date('2026-11-10T07:00:00.000Z');
const ALL = { id: 'a', permissions: ['OBSERVABILITY_VIEW', 'MARKETING_VIEW_ALL'] };
const OWNER = { id: '11111111-1111-4111-8111-111111111111', permissions: ['OBSERVABILITY_VIEW'] };

describe('Storefront Health (P1R)', () => {
  it('asserts nothing without probe or alert evidence', async () => {
    const prisma = prismaMock({ last: new Date('2026-11-10T06:59:00Z'), count: 9 });
    const service = new ObservabilityService(prisma as never);
    const result = await service.health(ALL, NOW);
    expect(result.status).toBe('UNKNOWN');
    expect(result.reason).toMatch(/cannot be asserted/i);
    expect(result.sections.availability.state).toBe('NO_DATA');
    expect(result.sections.issues.state).toBe('NO_DATA');
    expect(result.sections.pageExperience.state).toBe('NOT_ENABLED');
    expect(result.sections.checkout.state).toBe('UNKNOWN');
    expect(result.asOf).toBe(NOW.toISOString());
  });

  it('reports Telemetry Activity facts without asserting pipeline health', async () => {
    const prisma = prismaMock({ last: new Date('2026-11-10T06:59:00Z'), count: 418 });
    const service = new ObservabilityService(prisma as never);
    const result = await service.health(ALL, NOW);
    expect(result.telemetryActivity.state).toBe('VALUE');
    expect(result.telemetryActivity.events24h).toBe(418);
    expect(result.telemetryActivity.lastEventAt).toBe('2026-11-10T06:59:00.000Z');
    expect(result.telemetryActivity.sources).toEqual(['analytics_events']);
    expect(result.telemetryActivity.note).toMatch(/does not assert pipeline/i);
  });

  it('withholds platform telemetry from owner-scoped views without querying', async () => {
    const prisma = prismaMock({ last: null, count: 0 });
    const service = new ObservabilityService(prisma as never);
    const result = await service.health(OWNER, NOW);
    expect(result.telemetryActivity.state).toBe('UNKNOWN');
    expect(result.telemetryActivity.note).toMatch(/owner-scoped/i);
    expect(result.telemetryActivity.events24h).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('degrades a failed telemetry lookup to UNKNOWN, never zero', async () => {
    const prisma = prismaMock(new Error('db paused'));
    const service = new ObservabilityService(prisma as never);
    const result = await service.health(ALL, NOW);
    expect(result.telemetryActivity.state).toBe('UNKNOWN');
    expect(result.telemetryActivity.events24h).toBeUndefined();
  });
});
