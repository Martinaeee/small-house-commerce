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

function makeService(marketingTouch?: { resolve: (credential: string) => Promise<{ linkId: string | null } | null> }) {
  const prisma = { analyticsEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  const touch = marketingTouch ?? { resolve: vi.fn(async () => ({ linkId: null })) };
  return { prisma, marketingTouch: touch, service: new AnalyticsService(prisma as never, touch as never) };
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
    const service = new AnalyticsService(prisma as never, { resolve: vi.fn(async () => null) } as never);

    await expect(service.ingest([event()], 'client')).resolves.toEqual({ accepted: 0 });
  });
});

describe('campaign link attribution from the touch credential', () => {
  const touchEvent = (credential?: string, eventName: 'ADD_TO_CART' | 'BEGIN_CHECKOUT' = 'ADD_TO_CART') =>
    event({ eventName, marketingCredential: credential });

  it('attributes each event to its own link and verifies each distinct credential once', async () => {
    const resolve = vi.fn<(c: string) => Promise<{ linkId: string | null } | null>>()
      .mockResolvedValueOnce({ linkId: 'link-a' })
      .mockResolvedValueOnce({ linkId: 'link-b' });
    const { prisma, service } = makeService({ resolve });
    await service.ingest(
      [
        touchEvent('cred-a'),
        touchEvent('cred-a'),
        touchEvent('cred-b', 'BEGIN_CHECKOUT'),
      ],
      'client',
    );
    const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
    expect(data[0].campaignLinkId).toBe('link-a');
    expect(data[1].campaignLinkId).toBe('link-a');
    expect(data[2].campaignLinkId).toBe('link-b');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('keeps storing events whose credential is missing or fails verification, with no link', async () => {
    const resolve = vi.fn<(c: string) => Promise<{ linkId: string | null } | null>>().mockRejectedValue(new Error('boom'));
    const { prisma, service } = makeService({ resolve });
    await service.ingest([touchEvent('cred-x'), touchEvent()], 'client');
    // The default createMany stub counts one accepted row regardless of size;
    // the contract under test is that both rows still reach the database.
    expect(prisma.analyticsEvent.createMany).toHaveBeenCalledOnce();
    const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0].campaignLinkId).toBeNull();
    expect(data[1].campaignLinkId).toBeNull();
  });

  it('treats an expired credential as unattributed, not an error', async () => {
    const resolve = vi.fn<(c: string) => Promise<{ linkId: string | null } | null>>().mockResolvedValue(null);
    const { marketingTouch, prisma, service } = makeService({ resolve });
    await service.ingest([touchEvent('expired')], 'client');
    const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
    expect(data[0].campaignLinkId).toBeNull();
    expect(marketingTouch.resolve).toHaveBeenCalledOnce();
  });

  it('omits campaign_link_id from plain events that never carry a credential', async () => {
    const { prisma, service } = makeService();
    await service.ingest([event()], 'client');
    const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
    expect(data[0].campaignLinkId ?? null).toBeNull();
  });
});
