import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import type { AnalyticsEventInput } from './dto/analytics-event.dto.js';

function event(overrides: Partial<AnalyticsEventInput> = {}): AnalyticsEventInput {
  return {
    eventName: 'PAGE_VIEW',
    sessionId: 'session-1234',
    pageUrl: 'https://luwag.ph/',
    pagePath: '/',
    deviceType: 'mobile',
    ...overrides,
  };
}

function makeService() {
  const prisma = { analyticsEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  return { prisma, service: new AnalyticsService(prisma as never) };
}

describe('AnalyticsService.ingest', () => {
  it('writes storefront events with a Manila event day', async () => {
    const { prisma, service } = makeService();
    const result = await service.ingest([event()], 'client');

    expect(result.accepted).toBe(1);
    const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ eventName: 'PAGE_VIEW', sessionId: 'session-1234' });
    expect(data[0].eventDay).toBeInstanceOf(Date);
    expect(prisma.analyticsEvent.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('drops admin and preview traffic', async () => {
    const { prisma, service } = makeService();
    const result = await service.ingest(
      [event({ pagePath: '/admin/orders' }), event({ pagePath: '/preview/abc' })],
      'client',
    );

    expect(result.accepted).toBe(0);
    expect(prisma.analyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('stores an impression with its section identity', async () => {
    const { prisma, service } = makeService();
    await service.ingest(
      [
        event({
          eventName: 'HOMEPAGE_SECTION_IMPRESSION',
          sectionId: '11111111-1111-4111-8111-111111111111',
          sectionType: 'HERO',
        }),
      ],
      'client',
    );
    const row = prisma.analyticsEvent.createMany.mock.calls[0][0].data[0];
    expect(row.sectionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(row.sectionType).toBe('HERO');
  });

  it('refuses a batch once the per-address budget is spent', async () => {
    const { service } = makeService();
    const batch = Array.from({ length: 20 }, () => event());

    for (let index = 0; index < 6; index += 1) {
      await expect(service.ingest(batch, 'flooder')).resolves.toMatchObject({ accepted: 1 });
    }
    const blocked = await service.ingest(batch, 'flooder');

    expect(blocked.accepted).toBe(0);
    expect(service.isRateLimited('flooder')).toBe(true);
  });

  it('never throws when the database rejects a batch', async () => {
    const prisma = {
      analyticsEvent: { createMany: vi.fn().mockRejectedValue(new Error('db down')) },
    };
    const service = new AnalyticsService(prisma as never);

    await expect(service.ingest([event()], 'client')).resolves.toEqual({ accepted: 0 });
  });
});
