import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  marketingTestDatabase,
  createMarketingTestPrisma,
} from '../../../test/marketing-test-prisma.js';
import { MarketingFunnelService } from './marketing-funnel.service.js';
import {
  marketingFunnelQuerySchema,
  marketingFunnelSessionsQuerySchema,
} from './dto/marketing-funnel.dto.js';
import type { AnalyticsEventName } from '../../generated/prisma/client.js';

const db = marketingTestDatabase();
describe.skipIf(!db)('funnel PostgreSQL facts and customer boundary', () => {
  const p = db ? createMarketingTestPrisma(db) : null!;
  const service = new MarketingFunnelService(p);
  const tag = randomUUID();
  let productId: string,
    secondId: string,
    skuId: string,
    secondSku: string,
    ownerId: string,
    otherId: string,
    linkId: string,
    otherLinkId: string,
    categoryId: string;
  const all = { id: randomUUID(), permissions: ['MARKETING_VIEW_ALL'] };
  const query = (extra = {}) =>
    marketingFunnelQuerySchema.parse({
      from: '2026-11-05',
      to: '2026-11-05',
      productId,
      ...extra,
    });
  const sq = (extra = {}) =>
    marketingFunnelSessionsQuerySchema.parse({
      from: '2026-11-05',
      to: '2026-11-05',
      productId,
      ...extra,
    });
  const session = 'funnel-' + tag;
  const at = new Date('2026-11-05T02:00:00Z');
  async function event(
    eventName: AnalyticsEventName,
    sid: string,
    extra: Record<string, unknown> = {},
  ) {
    await p.analyticsEvent.create({
      data: {
        eventName,
        sessionId: sid,
        pagePath: '/checkout',
        pageUrl: '/checkout',
        deviceType: 'mobile',
        eventDay: new Date('2026-11-05'),
        createdAt: at,
        ...extra,
      },
    });
  }
  beforeAll(async () => {
    await p.$connect();
    categoryId = (await p.category.create({ data: { name: tag, slug: tag } }))
      .id;
    productId = (
      await p.product.create({
        data: { name: tag, slug: tag, categoryId, status: 'ACTIVE' },
      })
    ).id;
    secondId = (
      await p.product.create({
        data: {
          name: tag + '-b',
          slug: tag + '-b',
          categoryId,
          status: 'ACTIVE',
        },
      })
    ).id;
    const v = await p.productVariant.create({
      data: { productId, name: 'Walnut', combinationKey: tag },
    });
    const v2 = await p.productVariant.create({
      data: { productId: secondId, name: 'Oak', combinationKey: tag + '-b' },
    });
    skuId = (
      await p.sku.create({ data: { productId, variantId: v.id, skuCode: tag } })
    ).id;
    secondSku = (
      await p.sku.create({
        data: { productId: secondId, variantId: v2.id, skuCode: tag + '-b' },
      })
    ).id;
    ownerId = (
      await p.user.create({
        data: {
          name: 'Owner',
          email: tag + '@test.invalid',
          passwordHash: 'x',
        },
      })
    ).id;
    otherId = (
      await p.user.create({
        data: {
          name: 'Other',
          email: tag + 'other@test.invalid',
          passwordHash: 'x',
        },
      })
    ).id;
    linkId = (
      await p.campaignLink.create({
        data: {
          productId,
          ownerUserId: ownerId,
          code: tag,
          name: tag,
          aidSnapshot: 'test',
          sourceType: 'META_AD',
        },
      })
    ).id;
    otherLinkId = (
      await p.campaignLink.create({
        data: {
          productId,
          ownerUserId: otherId,
          code: tag + 'other',
          name: tag,
          aidSnapshot: 'test2',
          sourceType: 'FB_POST',
        },
      })
    ).id;
    for (const path of [
      '/products/' + tag,
      '/products/' + tag,
      '/products/' + tag + '-b',
    ])
      await event('PAGE_VIEW', session, {
        pagePath: path,
        campaignLinkId: linkId,
      });
    await event('PRODUCT_VIEW', session, { productId, campaignLinkId: linkId });
    await event('ADD_TO_CART', session, { productId, campaignLinkId: linkId });
    await event('BEGIN_CHECKOUT', session, {
      entityId: skuId + ',' + secondSku,
      campaignLinkId: linkId,
    });
    await event('CHECKOUT_SUBMIT_ATTEMPT', session, {
      entityId: skuId,
      campaignLinkId: linkId,
      metadata: {
        step: 'confirm',
        attemptId: tag,
        retry: 1,
        skuIds: [skuId, secondSku],
      },
    });
    for (let retry = 1; retry <= 3; retry++)
      await event('CHECKOUT_SUBMIT_FAILED', session, {
        campaignLinkId: linkId,
        metadata: {
          step: 'confirm',
          attemptId: tag,
          retry,
          reason: 'STOCK',
          skuIds: [skuId, secondSku],
          idempotencyKey: 'complete-key',
          customer: {
            name: 'Ana',
            phone: '09171234567',
            streetAddress: 'Exact private address',
          },
        },
      });
    await event('PAGE_VIEW', session + 'organic', {
      pagePath: '/products/' + tag,
    });
    await event('CHECKOUT_SUBMIT_FAILED', session + 'other', {
      campaignLinkId: otherLinkId,
      metadata: {
        step: 'confirm',
        reason: 'SERVER',
        skuIds: [skuId],
        customer: { name: 'Other private' },
      },
    });
  });
  afterAll(async () => {
    await p.analyticsEvent.deleteMany({
      where: { sessionId: { startsWith: session } },
    });
    await p.campaignLink.deleteMany({
      where: { id: { in: [linkId, otherLinkId].filter(Boolean) } },
    });
    await p.product.deleteMany({
      where: { id: { in: [productId, secondId].filter(Boolean) } },
    });
    if (categoryId) await p.category.delete({ where: { id: categoryId } });
    await p.user.deleteMany({
      where: { id: { in: [ownerId, otherId].filter(Boolean) } },
    });
    await p.$disconnect();
  });
  it('dedupes sessions, resolves legacy entity ids and full metadata baskets', async () => {
    const result = await service.funnel(query(), all);
    expect(result.rows[0]).toMatchObject({
      visits: 2,
      views: 1,
      addToCarts: 1,
      checkouts: 1,
      attempts: 1,
      failures: 2,
    });
    const second = await service.funnel(query({ productId: secondId }), all);
    expect(second.rows[0]).toMatchObject({
      visits: 1,
      checkouts: 1,
      attempts: 1,
      failures: 1,
    });
  });
  it('isolates owners at the event and does not expose PII in aggregates', async () => {
    const own = { id: ownerId, permissions: ['MARKETING_VIEW_OWN'] };
    const result = await service.funnel(query(), own);
    expect(result.rows[0]).toMatchObject({ visits: 1, failures: 1 });
    const detail = await service.detail(productId, query(), own);
    expect(JSON.stringify([result, detail])).not.toMatch(
      /09171234567|streetAddress|complete-key|Other private/,
    );
    const sessions = await service.sessions(sq({ onlyFailures: 'true' }), own);
    expect(sessions.items).toHaveLength(1);
    expect(JSON.stringify(sessions)).toContain('Exact private address');
    expect(JSON.stringify(sessions)).not.toContain('Other private');
  });
  it('filters organic traffic, failure cause and malformed cursors', async () => {
    const organic = await service.funnel(query({ traffic: 'ORGANIC' }), all);
    expect(organic.rows[0]).toMatchObject({
      visits: 1,
      checkouts: 0,
      failures: 0,
    });
    const sessions = await service.sessions(sq({ reason: 'STOCK' }), all);
    expect(sessions.items).toHaveLength(1);
    expect(
      sessions.items[0].events.filter(
        (e) => e.eventName === 'CHECKOUT_SUBMIT_FAILED',
      ),
    ).toHaveLength(3);
    await expect(
      service.sessions(sq({ cursor: 'invalid' }), all),
    ).rejects.toThrow('Invalid cursor');
  });
});
