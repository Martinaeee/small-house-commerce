import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LandingPagesService } from '../catalog/landing/landing-pages.service.js';
import { LandingSnapshotService } from '../catalog/landing/landing-snapshot.service.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { OptimizersService } from './optimizers.service.js';
import { MarketingTouchService } from './marketing-touch.service.js';

const database = process.env.MARKETING_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/small_house_marketing_dev') throw new Error('Touch integration requires the dedicated local marketing database.');
}

describe.skipIf(!database)('marketing touch PostgreSQL deduplication', () => {
  let prisma: PrismaService;
  let touch: MarketingTouchService;
  let links: CampaignLinksService;
  let pages: LandingPagesService;
  let userId: string;
  let productId: string;
  let categoryId: string;
  const tag = randomUUID();
  const account = () => ({ id: userId, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    userId = (await prisma.user.create({ data: { name: 'Touch owner', email: `touch-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'Touch integration', slug: `touch-${tag}` } })).id;
    productId = (await prisma.product.create({ data: { categoryId, name: 'Touch parent', slug: `touch-${tag}`, productCode: `TOUCH-${tag}`, status: 'ACTIVE', solutions: [] } })).id;
    const optimizers = new OptimizersService(prisma);
    pages = new LandingPagesService(prisma, {} as never, new LandingSnapshotService(prisma), optimizers);
    links = new CampaignLinksService(prisma, optimizers);
    touch = new MarketingTouchService(prisma, links, optimizers, new ConfigService({ jwt: { secret: 'touch-postgres-local-only-secret-2026' } }));
  }, 20000);

  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    if (!prisma) return;
    if (productId) {
      await prisma.campaignLinkVisit.deleteMany({ where: { link: { productId } } });
      await prisma.campaignLink.deleteMany({ where: { productId } });
      await prisma.landingPageVisit.deleteMany({ where: { landingPage: { productId } } });
      await prisma.productLandingPage.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function target() {
    const draft = await pages.createDraft(productId, { name: 'Touch page' }, account());
    const page = await pages.publish(draft.id, draft.version, account());
    const link = await links.createLink({ productId, landingPageId: page.id, sourceType: 'META_AD', name: 'Touch ad', adId: 'ad-A' }, account());
    return { page, link };
  }

  it('handles concurrent first hits without duplicates and counts one page independently of its two links', async () => {
    const { page, link } = await target();
    const copy = await links.cloneLink(link.id, { adId: 'ad-B' }, account());
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T15:59:59Z'));
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => touch.touch({ code: i % 2 ? copy.code : link.code, visitKey: 'same-tab' })));
    expect(results.every((value) => typeof value.credential === 'string')).toBe(true);
    expect(await prisma.campaignLinkVisit.count({ where: { linkId: { in: [link.id, copy.id] } } })).toBe(2);
    expect(await prisma.landingPageVisit.count({ where: { landingPageId: page.id } })).toBe(1);
    expect((await prisma.landingPageVisit.findFirstOrThrow({ where: { landingPageId: page.id } })).visitDay.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
    await touch.touch({ code: link.code, visitKey: 'same-tab' });
    expect(await prisma.campaignLinkVisit.count({ where: { linkId: { in: [link.id, copy.id] } } })).toBe(3);
    expect(await prisma.landingPageVisit.count({ where: { landingPageId: page.id } })).toBe(2);
    await pages.recordView(page.slug, 'same-tab');
    expect(await prisma.landingPageVisit.count({ where: { landingPageId: page.id } })).toBe(2);
  }, 20000);

  it('preserves an existing immutable credential through rename, republish and link disable', async () => {
    const { page, link } = await target();
    const result = await touch.touch({ code: link.code, visitKey: 'snapshot-tab', aid: 'FORGED', adId: 'URL-ad' });
    const snapshot = await touch.resolve(result.credential);
    expect(snapshot).toMatchObject({ ownerUserId: userId, linkId: link.id, adId: 'ad-A', publishedRevision: 1 });
    await prisma.optimizerProfile.update({ where: { userId }, data: { displayName: 'Renamed owner' } });
    await pages.publish(page.id, page.version, account());
    await links.disableLink(link.id, link.version, account());
    expect(await touch.resolve(result.credential)).toEqual(snapshot);
    expect((await touch.touch({ code: link.code, landingPageId: page.id, visitKey: 'after-disable' })).credential).toBeNull();
    expect(await prisma.campaignLinkVisit.count({ where: { linkId: link.id } })).toBe(1);
  });

  it('separates DIRECT and registered legacy attribution from persisted paid links', async () => {
    const { page } = await target();
    const profile = await prisma.optimizerProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.id).not.toBe(userId);
    const direct = await touch.touch({ path: `/lp/${page.slug}`, visitKey: 'direct-tab', adId: 'forged-paid-ad' });
    expect(await touch.resolve(direct.credential)).toMatchObject({ ownerUserId: userId, sourceType: 'DIRECT', legacy: false, linkId: null, adId: null });
    const legacy = await touch.touch({ aid: profile.aid, path: `/lp/${page.slug}`, visitKey: 'legacy-tab', sourceType: 'FB_POST', facebookPostId: 'legacy-post' });
    expect(await touch.resolve(legacy.credential)).toMatchObject({ ownerUserId: userId, sourceType: 'FB_POST', legacy: true, linkId: null, facebookPostId: 'legacy-post' });
    expect((await touch.touch({ aid: 'NEVER-REGISTERED', path: `/lp/${page.slug}`, visitKey: 'unknown-tab' })).credential).toBeNull();
    expect(await prisma.optimizerProfile.count({ where: { aid: 'NEVER-REGISTERED' } })).toBe(0);
    expect(await prisma.campaignLinkVisit.count({ where: { link: { landingPageId: page.id } } })).toBe(0);
  });
});
