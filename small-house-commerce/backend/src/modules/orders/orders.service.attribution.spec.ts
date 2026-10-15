import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { CampaignLinksService } from '../marketing/campaign-links.service.js';
import { MarketingTouchService } from '../marketing/marketing-touch.service.js';
import { OptimizersService } from '../marketing/optimizers.service.js';
import { checkoutSchema } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

const USER = '11111111-1111-4111-a111-111111111111';
const PROFILE = '22222222-2222-4222-a222-222222222222';
const PRODUCT = '33333333-3333-4333-a333-333333333333';
const PAGE = '44444444-4444-4444-a444-444444444444';
const LINK = '55555555-5555-4555-a555-555555555555';
const SKU = '66666666-6666-4666-a666-666666666666';
const SECOND_SKU = '77777777-7777-4777-a777-777777777777';
const START = new Date('2026-10-11T01:00:00Z');

function setup() {
  let inTransaction = false;
  const writes: Prisma.OrderCreateInput[] = [];
  const profile = { displayName: 'Owner at touch', status: 'ACTIVE' };
  const page = { slug: 'campaign', publishedContent: { blocks: [] }, publishedRevision: 3, status: 'ACTIVE', startAt: null, endAt: null };
  const link = { id: LINK, code: 'abcdefghijklmnop', ownerUserId: USER, aidSnapshot: 'OP-1', productId: PRODUCT, variantId: null, landingPageId: PAGE, sourceType: 'META_AD', campaignId: 'campaign-A', adsetId: 'set-A', adId: 'ad-A', utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'A', utmContent: 'creative', utmTerm: 'chair', status: 'ACTIVE', product: { status: 'ACTIVE', name: 'Entry product', productCode: 'ENTRY-001', slug: 'chair' }, landingPage: page, owner: { name: 'Owner', status: 'ACTIVE', optimizerProfile: profile } };
  const tx = {
    order: { create: vi.fn(async ({ data }: { data: Prisma.OrderCreateInput }) => { writes.push(data); return { id: 'order-1' }; }) },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
    campaignLinkVisit: { createMany: vi.fn(async () => ({ count: 1 })) },
    landingPageVisit: { createMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    customer: { upsert: vi.fn(async () => ({ id: 'customer-1' })) },
    sku: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, skuCode: where.id === SKU ? 'SKU-A' : 'SKU-B', status: 'ACTIVE', price: new Prisma.Decimal(where.id === SKU ? '199' : '49'), landedCost: null, variant: { id: PAGE, name: 'Standard', productId: where.id === SKU ? PRODUCT : PROFILE, product: { id: where.id === SKU ? PRODUCT : PROFILE, name: 'Bought product', status: 'ACTIVE' } } })) },
    campaignLink: { findUnique: vi.fn(async () => link) },
    $queryRaw: vi.fn(async () => [{ nextval: 1n }]),
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => { inTransaction = true; try { return await work(tx); } finally { inTransaction = false; } }),
  };
  const inventory = { availableBySku: vi.fn(async () => new Map([[SKU, 5], [SECOND_SKU, 5]])), defaultWarehouse: vi.fn(async () => ({ id: 'warehouse-1' })), reserveWithin: vi.fn(async () => ({})) };
  const risk = { classifyForNewOrder: vi.fn(async () => ({ classification: 'NEW', reason: 'No prior orders', previousOrderId: null })), logRisk: vi.fn(async () => {}), markDuplicates: vi.fn(async () => {}) };
  const optimizers = new OptimizersService(prisma as never);
  const touch = new MarketingTouchService(prisma as never, new CampaignLinksService(prisma as never, optimizers), optimizers, new ConfigService({ jwt: { secret: 'order-attribution-only-unit-test-secret' } }));
  const resolvedInside: boolean[] = [];
  const originalResolve = touch.resolve.bind(touch);
  vi.spyOn(touch, 'resolve').mockImplementation(async (credential) => { resolvedInside.push(inTransaction); return originalResolve(credential); });
  const service = new OrdersService(
    prisma as never,
    inventory as never,
    risk as never,
    touch,
    { resolveForCheckout: vi.fn() } as never,
    { deliverClaims: vi.fn(async () => undefined) } as never,
  );
  const input = (marketingCredential?: string, attribution: Record<string, unknown> = {}) => checkoutSchema.parse({ customer: { name: 'Jane', phone: '09171234567', province: 'Metro Manila', city: 'Manila', streetAddress: '1 Main St' }, items: [{ skuId: SKU, quantity: 1 }], marketingCredential, attribution });
  const credential = async () => {
    const result = await touch.touch({ code: link.code, visitKey: 'tab-1' });
    expect(result.credential).toEqual(expect.any(String));
    return result.credential!;
  };
  return { service, touch, link, page, profile, writes, inventory, risk, input, credential, resolvedInside };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START); });
afterEach(() => vi.useRealTimers());

describe('immutable order marketing attribution', () => {
  it('ignores client owner and advertising overrides and verifies the credential inside the order transaction', async () => {
    const h = setup();
    await h.service.checkout(h.input(await h.credential(), { sourceType: 'DIRECT', optimizerId: PROFILE, aid: 'FORGED', adId: 'forged-ad', landingPageId: PROFILE }));
    expect(h.writes[0]).toMatchObject({ optimizerId: USER, optimizerAidSnapshot: 'OP-1', optimizerNameSnapshot: 'Owner at touch', attribution: { create: { optimizerId: USER, aidSnapshot: 'OP-1', ownerNameSnapshot: 'Owner at touch', sourceType: 'META_AD', linkId: LINK, productId: PRODUCT, productNameSnapshot: 'Entry product', productCodeSnapshot: 'ENTRY-001', landingPageId: PAGE, publishedRevision: 3, adId: 'ad-A', utmContent: 'creative', utmTerm: 'chair', touchedAt: START, legacy: false } } });
    expect(h.resolvedInside).toEqual([true]);
  });

  it('writes the label and published revision at touch time even after rename, republish and disable', async () => {
    const h = setup();
    const credential = await h.credential();
    h.link.status = 'DISABLED'; h.profile.displayName = 'Renamed'; h.page.publishedRevision = 4;
    await h.service.checkout(h.input(credential));
    expect(h.writes[0]).toMatchObject({ optimizerNameSnapshot: 'Owner at touch', attribution: { create: { linkId: LINK, publishedRevision: 3, ownerNameSnapshot: 'Owner at touch' } } });
  });

  it.each(['missing', 'tampered', 'expired'])('does not recover marketing ownership from raw request fields when credential is %s', async (mode) => {
    const h = setup();
    let credential: string | undefined;
    if (mode !== 'missing') credential = await h.credential();
    if (mode === 'tampered') credential += 'x';
    if (mode === 'expired') vi.setSystemTime(new Date(START.getTime() + 8 * 864e5));
    await h.service.checkout(h.input(credential, { sourceType: 'META_AD', optimizerId: PROFILE, aid: 'OP-1', landingPageId: PAGE, adId: 'raw-ad' }));
    expect(h.writes[0]).toMatchObject({ optimizerId: null, optimizerAidSnapshot: null, optimizerNameSnapshot: null, attribution: { create: { sourceType: 'ORGANIC', optimizerId: null, aidSnapshot: null, linkId: null, touchedAt: null, landingPageId: null, adId: null } } });
    expect(h.writes[0].grandTotal.toString()).toBe('199');
  });

  it('keeps manual OTHER orders unattributed without fabricating a paid source', async () => {
    const h = setup();
    await h.service.checkout(h.input(undefined, { sourceType: 'OTHER' }));
    expect(h.writes[0]).toMatchObject({ attribution: { create: { sourceType: 'OTHER', optimizerId: null, linkId: null, touchedAt: null } } });
  });

  it('attributes a mixed-product cart once without changing totals, stock reservations or risk processing', async () => {
    const h = setup();
    const input = h.input(await h.credential());
    input.items.push({ skuId: SECOND_SKU, quantity: 1 });
    const result = await h.service.checkout(input);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].grandTotal.toString()).toBe('248');
    expect(h.writes[0].discountTotal.toString()).toBe('0');
    expect(h.writes[0]).toMatchObject({ customerClassification: 'NEW', attribution: { create: { linkId: LINK, productId: PRODUCT } } });
    expect(h.inventory.reserveWithin).toHaveBeenCalledTimes(2);
    expect(h.risk.logRisk).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', riskType: 'NEW' }));
    expect(h.risk.markDuplicates).toHaveBeenCalledWith('+639171234567');
    expect(result).toMatchObject({ orderStatus: 'NEW', confirmationStatus: 'UNCONFIRMED', requiresReview: false });
  });
});

describe('customer note persistence', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    ['  \n  ', null],
    ['  Call before delivery  ', 'Call before delivery'],
  ])('normalizes a submitted note %j to %j', (raw, expected) => {
    const input = checkoutSchema.parse({ ...setup().input(), customerNote: raw });
    expect(input.customerNote).toBe(expected);
  });

  it('accepts a 200-character note after trimming surrounding whitespace', () => {
    const input = checkoutSchema.parse({ ...setup().input(), customerNote: `  ${'x'.repeat(200)}  ` });
    expect(input.customerNote).toBe('x'.repeat(200));
  });

  it('rejects a submitted note longer than 200 characters', () => {
    expect(checkoutSchema.safeParse({ ...setup().input(), customerNote: 'x'.repeat(201) }).success).toBe(false);
  });

  it('writes a 200-character note unchanged on the order row', async () => {
    const h = setup();
    const input = h.input(undefined, {});
    input.customerNote = 'x'.repeat(200);
    await h.service.checkout(input);
    expect(h.writes[0]).toMatchObject({ customerNote: 'x'.repeat(200) });
  });

  it('writes the customer note on the order row', async () => {
    const h = setup();
    const input = h.input(undefined, {});
    input.customerNote = 'Call before delivery';
    await h.service.checkout(input);
    expect(h.writes[0]).toMatchObject({ customerNote: 'Call before delivery' });
  });

  it('writes null when the shopper left the note empty', async () => {
    const h = setup();
    await h.service.checkout(h.input(undefined, {}));
    expect(h.writes[0]).toMatchObject({ customerNote: null });
  });

  it('never copies the note into the attribution snapshot', async () => {
    const h = setup();
    const input = h.input(undefined, {});
    input.customerNote = 'Call before delivery';
    await h.service.checkout(input);
    const attribution = JSON.stringify(h.writes[0].attribution);
    expect(attribution).not.toContain('Call before delivery');
    expect(attribution).not.toContain('customerNote');
  });
});
