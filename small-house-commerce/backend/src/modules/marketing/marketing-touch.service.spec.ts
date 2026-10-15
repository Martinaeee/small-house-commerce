import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignLinksService } from './campaign-links.service.js';
import { MarketingTouchService } from './marketing-touch.service.js';
import { OptimizersService } from './optimizers.service.js';

const USER = '11111111-1111-4111-a111-111111111111';
const PROFILE = '22222222-2222-4222-a222-222222222222';
const PRODUCT = '33333333-3333-4333-a333-333333333333';
const PAGE = '44444444-4444-4444-a444-444444444444';
const LINK = '55555555-5555-4555-a555-555555555555';
const SECOND_LINK = '66666666-6666-4666-a666-666666666666';
const SECRET = 'touch-unit-only-secret-never-production-2026';
const START = new Date('2026-10-10T15:59:00.000Z');

type VisitData = { linkId?: string; landingPageId?: string; visitKey: string; visitDay: Date; createdAt: Date };

function setup() {
  const linkVisits = new Map<string, VisitData>();
  const pageVisits = new Map<string, VisitData>();
  const profile = { id: PROFILE, userId: USER, aid: 'OP-1', displayName: 'Operator at touch', status: 'ACTIVE' };
  const user = { name: 'Operator', status: 'ACTIVE', optimizerProfile: profile };
  const product = { id: PRODUCT, slug: 'chair', name: 'Saved chair', productCode: 'LUW-001', status: 'ACTIVE' };
  const page = { id: PAGE, slug: 'chair-ad', name: 'Ad page', productId: PRODUCT, ownerUserId: USER as string | null, publishedRevision: 3, publishedContent: { blocks: [] }, status: 'ACTIVE', startAt: null as Date | null, endAt: null as Date | null, product, owner: user as typeof user | null };
  const link = { id: LINK, code: 'abcdefghijklmnop', ownerUserId: USER, aidSnapshot: 'OP-1', productId: PRODUCT, product, landingPageId: PAGE, landingPage: page, variantId: null, owner: user, sourceType: 'META_AD', campaignId: 'campaign-A', adsetId: 'set-A', adId: 'ad-A', utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'campaign', utmContent: 'creative', utmTerm: null, status: 'ACTIVE' };
  const second = { ...link, id: SECOND_LINK, code: 'qrstuvwxyzABCDEF', adId: 'ad-B' };
  const prisma = {
    campaignLink: { findUnique: vi.fn(async ({ where }: { where: { code: string } }) => where.code === link.code ? link : where.code === second.code ? second : null) },
    optimizerProfile: { findUnique: vi.fn(async ({ where }: { where: { aid: string } }) => where.aid === profile.aid ? profile : null) },
    user: { findUnique: vi.fn(async () => user) },
    product: { findUnique: vi.fn(async () => product) },
    productLandingPage: { findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) => where.id === PAGE || where.slug === page.slug ? page : null) },
    campaignLinkVisit: { createMany: vi.fn(async ({ data }: { data: VisitData }) => { const key = `${data.linkId}/${data.visitKey}/${data.visitDay.toISOString()}`; if (!linkVisits.has(key)) linkVisits.set(key, data); return { count: 1 }; }) },
    landingPageVisit: { createMany: vi.fn(async ({ data }: { data: VisitData }) => { const key = `${data.landingPageId}/${data.visitKey}/${data.visitDay.toISOString()}`; if (!pageVisits.has(key)) pageVisits.set(key, data); return { count: 1 }; }) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => unknown) => work(prisma));
  const optimizers = new OptimizersService(prisma as never);
  const service = new MarketingTouchService(prisma as never, new CampaignLinksService(prisma as never, optimizers), optimizers, new ConfigService({ jwt: { secret: SECRET } }));
  return { service, prisma, link, second, page, profile, user, product, linkVisits, pageVisits };
}

async function mint(service: MarketingTouchService) {
  const result = await service.touch({ code: 'abcdefghijklmnop', visitKey: 'tab-1' });
  expect(result.credential).toEqual(expect.any(String));
  return result.credential!;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START); });
afterEach(() => vi.useRealTimers());

describe('server-signed marketing touch', () => {
  it('takes immutable attribution from the stored link rather than URL fields', async () => {
    const { service } = setup();
    const result = await service.touch({ code: 'abcdefghijklmnop', visitKey: 'tab-1', aid: 'FORGED', sourceType: 'DIRECT', adId: 'forged-ad', utmSource: 'forged' });
    expect(result.expiresAt).toBe('2026-10-17T15:59:00.000Z');
    expect(await service.resolve(result.credential)).toMatchObject({ ownerUserId: USER, ownerName: 'Operator at touch', aid: 'OP-1', linkId: LINK, productId: PRODUCT, productName: 'Saved chair', productCode: 'LUW-001', landingPageId: PAGE, publishedRevision: 3, sourceType: 'META_AD', campaignId: 'campaign-A', adsetId: 'set-A', adId: 'ad-A', utmSource: 'facebook', utmContent: 'creative', legacy: false, touchedAt: START.toISOString(), expiresAt: result.expiresAt });
  });

  it('rejects payload tampering and malformed MAC lengths without throwing', async () => {
    const { service } = setup();
    const credential = await mint(service);
    const [body, mac] = credential.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), ownerUserId: PROFILE })).toString('base64url');
    for (const value of [`${forgedBody}.${mac}`, `${body}.a`, `${credential}.extra`, '', 'not-a-token', null, 123]) await expect(service.resolve(value)).resolves.toBeNull();
  });

  it('does not accept the admin JWT secret directly as its signing key', async () => {
    const { service } = setup();
    const credential = await mint(service);
    const body = credential.split('.')[0];
    const wrongMac = createHmac('sha256', SECRET).update(body).digest('base64url');
    expect(await service.resolve(`${body}.${wrongMac}`)).toBeNull();
  });

  it('expires at exactly seven days and ordinary resolution never extends the window', async () => {
    const { service } = setup();
    const credential = await mint(service);
    vi.setSystemTime(new Date(START.getTime() + 7 * 864e5 - 1));
    expect(await service.resolve(credential)).toMatchObject({ expiresAt: '2026-10-17T15:59:00.000Z' });
    vi.setSystemTime(new Date(START.getTime() + 7 * 864e5));
    expect(await service.resolve(credential)).toBeNull();
  });

  it('does not downgrade an invalid code to a DIRECT page touch or invalidate the previous credential', async () => {
    const { service, pageVisits, linkVisits } = setup();
    const credential = await mint(service);
    const before = await service.resolve(credential);
    vi.setSystemTime(new Date(START.getTime() + 1000));
    expect(await service.touch({ code: 'unknown-code', landingPageId: PAGE, visitKey: 'tab-other' })).toEqual({ credential: null, expiresAt: null });
    expect(await service.resolve(credential)).toEqual(before);
    expect(linkVisits.size).toBe(1); expect(pageVisits.size).toBe(1);
  });

  it('stops new disabled-link touches but keeps the existing owner, label and published revision snapshot', async () => {
    const { service, link, profile, page, linkVisits } = setup();
    const credential = await mint(service);
    link.status = 'DISABLED'; profile.displayName = 'Renamed operator'; page.publishedRevision = 4;
    expect(await service.touch({ code: link.code, visitKey: 'tab-2' })).toEqual({ credential: null, expiresAt: null });
    expect(await service.resolve(credential)).toMatchObject({ ownerUserId: USER, ownerName: 'Operator at touch', publishedRevision: 3 });
    expect(linkVisits.size).toBe(1);
  });

  it('deduplicates links independently from pages and changes day at Manila midnight', async () => {
    const { service, link, second, pageVisits, linkVisits } = setup();
    await service.touch({ code: link.code, visitKey: 'tab-1' });
    await service.touch({ code: link.code, visitKey: 'tab-1' });
    await service.touch({ code: second.code, visitKey: 'tab-1' });
    expect(linkVisits.size).toBe(2); expect(pageVisits.size).toBe(1);
    expect([...pageVisits.values()][0].visitDay.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-10T16:00:00.000Z'));
    await service.touch({ code: link.code, visitKey: 'tab-1' });
    expect(linkVisits.size).toBe(3); expect(pageVisits.size).toBe(2);
    expect([...pageVisits.values()][1].visitDay.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    await service.touch({ code: link.code, visitKey: 'tab-2' });
    expect(linkVisits.size).toBe(4); expect(pageVisits.size).toBe(3);
  });

  it('does not count a link used with a different product, page or public path', async () => {
    const { service, link, linkVisits, pageVisits } = setup();
    for (const target of [{ productId: PROFILE }, { landingPageId: PROFILE }, { path: '/products/other-chair' }]) expect((await service.touch({ code: link.code, visitKey: 'tab-1', ...target })).credential).toBeNull();
    expect(linkVisits.size).toBe(0); expect(pageVisits.size).toBe(0);
  });

  it('mints DIRECT attribution only for an actually live owned page, never a paid link', async () => {
    const { service, linkVisits, pageVisits } = setup();
    const result = await service.touch({ path: '/lp/chair-ad', visitKey: 'tab-1', adId: 'ad-A', sourceType: 'META_AD' });
    expect(await service.resolve(result.credential)).toMatchObject({ ownerUserId: USER, linkId: null, sourceType: 'DIRECT', legacy: false, landingPageId: PAGE, adId: null, campaignId: null });
    expect(linkVisits.size).toBe(0); expect(pageVisits.size).toBe(1);
  });

  it('does not create new touches for scheduled, ended or draft pages', async () => {
    for (const change of [{ startAt: new Date('2026-10-11T00:00:00Z') }, { endAt: new Date('2026-10-09T00:00:00Z') }, { status: 'DRAFT' }]) {
      const { service, page, pageVisits } = setup();
      Object.assign(page, change);
      expect((await service.touch({ landingPageId: PAGE, visitKey: 'tab-1' })).credential).toBeNull();
      expect((await service.touch({ code: 'abcdefghijklmnop', visitKey: 'tab-1' })).credential).toBeNull();
      expect(pageVisits.size).toBe(0);
    }
  });

  it('resolves legacy AID only through its registered User ID and never as a CampaignLink', async () => {
    const { service, linkVisits } = setup();
    const result = await service.touch({ aid: ' op-1 ', sourceType: 'FB_POST', adId: 'legacy-ad', path: '/products/chair', visitKey: 'tab-1' });
    expect(await service.resolve(result.credential)).toMatchObject({ ownerUserId: USER, aid: 'OP-1', legacy: true, linkId: null, sourceType: 'FB_POST', productId: PRODUCT, adId: 'legacy-ad' });
    expect(linkVisits.size).toBe(0);
  });

  it('does not guess an unknown legacy AID from an otherwise owned page', async () => {
    const { service } = setup();
    expect(await service.touch({ aid: 'UNKNOWN', landingPageId: PAGE, visitKey: 'tab-1' })).toEqual({ credential: null, expiresAt: null });
  });

  it('keeps unassigned public page visits without manufacturing an owner', async () => {
    const { service, page, pageVisits } = setup();
    page.ownerUserId = null; page.owner = null;
    expect(await service.touch({ landingPageId: PAGE, visitKey: 'tab-1' })).toEqual({ credential: null, expiresAt: null });
    expect(pageVisits.size).toBe(1);
  });
});
