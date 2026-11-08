import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignLinksService } from './campaign-links.service.js';
import { marketingTouchClaimsSchema } from './dto/marketing-touch.dto.js';
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
  const link = { id: LINK, code: 'abcdefghijklmnop', adid: 'AD-OP-1-261105-01', ownerUserId: USER, aidSnapshot: 'OP-1', productId: PRODUCT, product, landingPageId: PAGE, landingPage: page, variantId: null, owner: user, sourceType: 'META_AD', campaignId: 'campaign-A', adsetId: 'set-A', adId: 'ad-A', utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'campaign', utmContent: 'creative', utmTerm: null, status: 'ACTIVE' };
  const second = { ...link, id: SECOND_LINK, code: 'qrstuvwxyzABCDEF', adId: 'ad-B' };
  const prisma = {
    campaignLink: { findUnique: vi.fn(async ({ where }: { where: { code: string } }) => where.code === link.code ? link : where.code === second.code ? second : null) },
    optimizerProfile: { findUnique: vi.fn(async ({ where }: { where: { aid: string } }) => where.aid === profile.aid ? profile : null) },
    user: { findUnique: vi.fn(async () => user) },
    product: {
      findUnique: vi.fn(async () => product),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; slug?: string; status: string } }) =>
        product.status === where.status && (!where.id || where.id === product.id) && (!where.slug || where.slug === product.slug) ? product : null),
    },
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
  it('keeps link identity while letting URL attribution fields override link metadata', async () => {
    const { service } = setup();
    const result = await service.touch({ code: 'abcdefghijklmnop', visitKey: 'tab-1', aid: 'FORGED', sourceType: 'DIRECT', adId: 'forged-ad', utmSource: 'forged' });
    expect(result.expiresAt).toBe('2026-10-17T15:59:00.000Z');
    expect(await service.resolve(result.credential)).toMatchObject({ ownerUserId: USER, ownerName: 'Operator at touch', aid: 'OP-1', linkId: LINK, productId: PRODUCT, productName: 'Saved chair', productCode: 'LUW-001', landingPageId: PAGE, publishedRevision: 3, sourceType: 'META_AD', campaignId: 'campaign-A', adsetId: 'set-A', adId: 'ad-A', utmSource: 'forged', legacy: false, paid: true, touchedAt: START.toISOString(), expiresAt: result.expiresAt });
  });

  it('still accepts touches signed before the advertising number existed', async () => {
    const { service } = setup();
    const claims = await service.resolve(await mint(service));
    expect(claims).not.toBeNull();
    expect(marketingTouchClaimsSchema.safeParse(claims).success).toBe(true);
  });

  it('signs version 2 claims with the paid fields and no stable ad number', async () => {
    const { service } = setup();
    const credential = await mint(service);
    const payload = JSON.parse(Buffer.from(credential.split('.')[0]!, 'base64url').toString());
    expect(payload).not.toHaveProperty('adid');
    expect(payload).toMatchObject({ version: 2, linkId: LINK, sourceType: 'META_AD', adId: 'ad-A', paid: true });
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
    expect(await service.touch({ code: 'unknown-code', landingPageId: PAGE, visitKey: 'tab-other' })).toEqual({ credential: null, expiresAt: null, paid: false });
    expect(await service.resolve(credential)).toEqual(before);
    expect(linkVisits.size).toBe(1); expect(pageVisits.size).toBe(1);
  });

  it('stops new disabled-link touches but keeps the existing owner, label and published revision snapshot', async () => {
    const { service, link, profile, page, linkVisits } = setup();
    const credential = await mint(service);
    link.status = 'DISABLED'; profile.displayName = 'Renamed operator'; page.publishedRevision = 4;
    expect(await service.touch({ code: link.code, visitKey: 'tab-2' })).toEqual({ credential: null, expiresAt: null, paid: false });
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

  it('records a plain page visit without manufacturing attribution', async () => {
    const { service, linkVisits, pageVisits } = setup();
    const result = await service.touch({ path: '/lp/chair-ad', visitKey: 'tab-1', adId: '120212345678901234', sourceType: 'META_AD' });
    expect(result).toEqual({ credential: null, expiresAt: null, paid: false });
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

  it('resolves an AID-only paid touch through its optimizer and records no link', async () => {
    const { service, linkVisits } = setup();
    const result = await service.touch({ aid: ' op-1 ', adId: '120212345678901234', campaignId: '120200000000001', adsetId: '120200000000002', path: '/products/chair', visitKey: 'tab-1' });
    expect(await service.resolve(result.credential)).toMatchObject({ ownerUserId: USER, aid: 'OP-1', legacy: false, linkId: null, sourceType: 'META_AD', productId: PRODUCT, adId: '120212345678901234', campaignId: '120200000000001', adsetId: '120200000000002', paid: true });
    expect(linkVisits.size).toBe(0);
  });

  it('attributes a public slug to the ACTIVE product even when a draft shares that slug', async () => {
    const { service, prisma, product } = setup();
    prisma.product.findUnique.mockResolvedValueOnce({ ...product, id: PROFILE, status: 'DRAFT' });

    const result = await service.touch({ aid: 'OP-1', path: '/products/chair', visitKey: 'tab-1' });

    expect(await service.resolve(result.credential)).toMatchObject({ productId: PRODUCT, productName: 'Saved chair' });
  });

  it.each(['DRAFT', 'DISABLED'])('does not attribute a public slug when its only product is %s', async status => {
    const { service, product } = setup();
    product.status = status;

    expect(await service.touch({ aid: 'OP-1', path: '/products/chair', visitKey: 'tab-1' }))
      .toEqual({ credential: null, expiresAt: null, paid: false });
  });

  it('does not guess an unknown legacy AID from an otherwise owned page', async () => {
    const { service } = setup();
    expect(await service.touch({ aid: 'UNKNOWN', landingPageId: PAGE, visitKey: 'tab-1' })).toEqual({ credential: null, expiresAt: null, paid: false });
  });

  it.each(['123456', '120212345678901234', '12345678901234567890'])('uses numeric ad ID %s only when the Meta link has no saved ID', async adId => {
    const { service, link } = setup();
    Object.assign(link, { adId: null });
    const result = await service.touch({ code: link.code, visitKey: 'tab-1', adId, aid: 'FORGED', sourceType: 'DIRECT', campaignId: 'forged-campaign' });
    expect(await service.resolve(result.credential)).toMatchObject({ adId, linkId: LINK, ownerUserId: USER, aid: 'OP-1', sourceType: 'META_AD', campaignId: 'forged-campaign', paid: true });
    expect(link.adId).toBeNull();
  });

  it('overrides a saved ad ID with a valid numeric URL ID', async () => {
    const { service, link } = setup();
    link.adId = '120200000000001';
    const result = await service.touch({ code: link.code, visitKey: 'tab-1', adId: '120200000000002' });
    expect(await service.resolve(result.credential)).toMatchObject({ adId: '120200000000002' });
  });

  it.each([undefined, null, '', '{{ad.id}}', 'forged', '12345', '123456789012345678901', '120212345678901234,', '1e15'])('keeps valid link attribution when a fallback ad ID is invalid: %j', async adId => {
    const { service, link } = setup();
    Object.assign(link, { adId: null });
    const result = await service.touch({ code: link.code, visitKey: 'tab-1', adId });
    expect(await service.resolve(result.credential)).toMatchObject({ adId: null, linkId: LINK, ownerUserId: USER, sourceType: 'META_AD' });
  });

  it.each(['FB_POST', 'ORGANIC', 'DIRECT', 'EMAIL', 'OTHER'])('attaches a URL ad ID to a %s link', async sourceType => {
    const { service, link } = setup();
    Object.assign(link, { sourceType, adId: null });
    const result = await service.touch({ code: link.code, visitKey: 'tab-1', adId: '120212345678901234' });
    expect(await service.resolve(result.credential)).toMatchObject({ adId: '120212345678901234', sourceType });
  });

  it('keeps two ads on one link distinct without changing link identity or visit deduplication', async () => {
    const { service, link, linkVisits } = setup();
    Object.assign(link, { adId: null });
    const first = await service.touch({ code: link.code, visitKey: 'tab-1', adId: '120200000000001' });
    const second = await service.touch({ code: link.code, visitKey: 'tab-1', adId: '120200000000002' });
    expect(await service.resolve(first.credential)).toMatchObject({ linkId: LINK, adId: '120200000000001' });
    expect(await service.resolve(second.credential)).toMatchObject({ linkId: LINK, adId: '120200000000002' });
    expect(linkVisits.size).toBe(1);
  });

  it('keeps unassigned public page visits without manufacturing an owner', async () => {
    const { service, page, pageVisits } = setup();
    page.ownerUserId = null; page.owner = null;
    expect(await service.touch({ landingPageId: PAGE, visitKey: 'tab-1' })).toEqual({ credential: null, expiresAt: null, paid: false });
    expect(pageVisits.size).toBe(1);
  });
});
