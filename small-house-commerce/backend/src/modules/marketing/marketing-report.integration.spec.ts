import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { OrderStatus, PaymentStatus } from '../../generated/prisma/client.js';
import { MarketingReportService } from './marketing-report.service.js';
import { AdCostsService } from './ad-costs.service.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { OptimizersService } from './optimizers.service.js';

const database = process.env.MARKETING_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/small_house_marketing_dev') throw new Error('Report integration requires the dedicated local marketing database.');
}

describe.skipIf(!database)('marketing report PostgreSQL cohorts', () => {
  let prisma: PrismaService;
  let report: MarketingReportService;
  let costs: AdCostsService;
  let ownerId: string;
  let otherId: string;
  let categoryId: string;
  let productId: string;
  let customerId: string;
  let warehouseId: string;
  const tag = randomUUID();
  const own = () => ({ id: ownerId, permissions: ['MARKETING_VIEW_OWN'] });
  const writer = () => ({ id: ownerId, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });
  const query = (extra = {}) => ({ from: '2026-10-05', to: '2026-10-05', groupBy: 'LINK' as const, page: 1, pageSize: 20, ...extra });

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } })); await prisma.$connect();
    ownerId = (await prisma.user.create({ data: { name: 'Report owner', email: `report-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    otherId = (await prisma.user.create({ data: { name: 'Report other', email: `report-other-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'Report integration', slug: `report-${tag}` } })).id;
    productId = (await prisma.product.create({ data: { categoryId, name: 'Report parent', productCode: `REPORT-${tag}`, slug: `report-${tag}`, status: 'ACTIVE', solutions: [] } })).id;
    customerId = (await prisma.customer.create({ data: { name: 'Private report customer', normalizedPhone: `report-fixture-${tag}` } })).id;
    warehouseId = (await prisma.warehouse.create({ data: { name: `Report warehouse ${tag}` } })).id;
    report = new MarketingReportService(prisma);
    costs = new AdCostsService(prisma, new CampaignLinksService(prisma, new OptimizersService(prisma)));
  }, 20000);
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    if (!prisma) return;
    if (customerId) { await prisma.shipment.deleteMany({ where: { order: { customerId } } }); await prisma.order.deleteMany({ where: { customerId } }); await prisma.customer.delete({ where: { id: customerId } }); }
    if (productId) {
      await prisma.adCostAudit.deleteMany({ where: { cost: { link: { productId } } } });
      await prisma.adCostEntry.deleteMany({ where: { link: { productId } } });
      await prisma.campaignLinkVisit.deleteMany({ where: { link: { productId } } });
      await prisma.campaignLink.deleteMany({ where: { productId } });
      await prisma.landingPageVisit.deleteMany({ where: { landingPage: { productId } } });
      await prisma.productLandingPage.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    if (warehouseId) await prisma.warehouse.delete({ where: { id: warehouseId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  async function target(createdAt = '2026-10-03T16:00:00Z') {
    const page = await prisma.productLandingPage.create({ data: { productId, ownerUserId: ownerId, name: 'Report page', slug: `report-${randomUUID()}` } });
    const link = await prisma.campaignLink.create({ data: { productId, landingPageId: page.id, ownerUserId: ownerId, aidSnapshot: 'REPORT-OWNER', name: 'Report ad', code: randomUUID().replaceAll('-', '').slice(0, 16), sourceType: 'META_AD', createdAt: new Date(createdAt) } });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T01:00:00Z'));
    return { page, link };
  }
  async function order(destination: Awaited<ReturnType<typeof target>>, extra: { status?: OrderStatus; payment?: PaymentStatus; value?: string; touchedAt?: string | null; createdAt?: string; source?: 'REGISTERED' | 'DIRECT' | 'LEGACY' | 'UNVERIFIED'; shipments?: (string | null)[]; confirmationHistory?: boolean; risk?: boolean } = {}) {
    const source = extra.source ?? 'REGISTERED';
    const value = extra.value ?? '10000.00';
    const row = await prisma.order.create({ data: {
      orderNumber: `REPORT-${randomUUID()}`, customerId, subtotal: value, discountTotal: 0, shippingTotal: 0, grandTotal: value, orderStatus: extra.status ?? 'SHIPPING', paymentStatus: extra.payment ?? 'COD_PENDING', createdAt: new Date(extra.createdAt ?? '2026-10-06T01:00:00Z'), customerClassification: extra.risk ? 'RPT' : 'NEW',
      attribution: { create: { optimizerId: ownerId, aidSnapshot: 'REPORT-OWNER', ownerNameSnapshot: 'Report owner', productId, productNameSnapshot: 'Report parent', sourceType: source === 'DIRECT' ? 'DIRECT' : 'META_AD', linkId: source === 'REGISTERED' ? destination.link.id : null, landingPageId: destination.page.id, touchedAt: source === 'UNVERIFIED' ? null : new Date(extra.touchedAt ?? '2026-10-04T16:30:00Z'), legacy: source === 'UNVERIFIED' ? null : source === 'LEGACY' } },
      ...(extra.confirmationHistory ? { statusHistory: { create: { statusDomain: 'CONFIRMATION_STATUS', newStatus: 'CONFIRMED', source: 'ADMIN' } } } : {}),
      ...(extra.risk ? { riskFlags: { create: { flagType: 'POSSIBLE_DUPLICATE', resolved: false } } } : {}),
    } });
    for (const signedAt of extra.shipments ?? []) await prisma.shipment.create({ data: { orderId: row.id, warehouseId, carrier: 'Report fixture', status: signedAt ? 'SIGNED' : 'SHIPPING', shippedAt: new Date('2026-10-07T01:00:00Z'), signedAt: signedAt ? new Date(signedAt) : null } });
    return row;
  }
  async function expense(linkId: string, costDate = '2026-10-05', amountUsd = '50.00') { return costs.upsertCost({ linkId, costDate, amountUsd, phpPerUsd: amountUsd === '0.00' ? null : '57.3' }, writer()); }

  it('keeps a late full signing in its original touch cohort and counts the whole order only once', async () => {
    const t = await target();
    await order(t, { shipments: ['2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z'], confirmationHistory: true });
    await expense(t.link.id);
    const result = await report.report(query({ linkIds: [t.link.id] }), own());
    expect(result.rows[0]).toMatchObject({ submittedOrders: 1, validOrders: 1, confirmedOrders: 1, signedOrders: 1, signedGrossPhp: '10000.00', spendPhp: '2865.00', signedRoas: '3.49' });
    expect((await report.report(query({ from: '2026-10-12', to: '2026-10-12', linkIds: [t.link.id] }), own())).rows[0]).toMatchObject({ signedOrders: 0, signedGrossPhp: '0.00' });
  });

  it('retains cancellation, duplicate and risk evidence without silently deleting submitted orders', async () => {
    const t = await target();
    await order(t, { status: 'CANCELLED', confirmationHistory: true });
    await order(t, { status: 'CONFIRMED', value: '200.00', risk: true });
    await order(t, { status: 'DENIED' });
    const result = await report.report(query({ linkIds: [t.link.id] }), own());
    expect(result.rows[0]).toMatchObject({ submittedOrders: 3, validOrders: 1, confirmedOrders: 0, signedOrders: 0, validOrderValuePhp: '200.00', duplicateOrders: 1, riskOrders: 1 });
  });

  it('does not count a partial box receipt or a bare SIGNED status as a fully signed order', async () => {
    const t = await target();
    await order(t, { shipments: ['2026-10-12T01:00:00Z', null] });
    await order(t, { status: 'SIGNED' });
    expect((await report.report(query({ linkIds: [t.link.id] }), own())).rows[0]).toMatchObject({ submittedOrders: 2, signedOrders: 0, signedGrossPhp: '0.00' });
  });

  it('keeps actual signing gross through AFTER_SALES and reports refund status without inventing refund money', async () => {
    const t = await target();
    await order(t, { status: 'AFTER_SALES', payment: 'PARTIALLY_REFUNDED', shipments: ['2026-10-12T01:00:00Z'], confirmationHistory: true });
    const result = await report.report(query({ linkIds: [t.link.id] }), own());
    expect(result.rows[0]).toMatchObject({ signedOrders: 1, signedGrossPhp: '10000.00', afterSalesOrders: 1, refundStatusOrders: 1, confirmedOrders: 1 });
    expect(JSON.stringify(result)).not.toMatch(/refundAmount|netProfit|normalizedPhone|Private report customer/);
  });

  it('marks missing days incomplete, ignores pre-creation days, and recognizes explicit zero without infinite ratios', async () => {
    const t = await target('2026-10-04T16:00:00Z');
    await order(t); await expense(t.link.id);
    const range = query({ from: '2026-10-03', to: '2026-10-07', linkIds: [t.link.id] });
    expect((await report.report(range, own())).rows[0]).toMatchObject({ expectedCostDays: 3, recordedCostDays: 1, costCoverageComplete: false, signedRoas: null, orderCpaUsd: null });
    const six = await expense(t.link.id, '2026-10-06', '0.00'); await expense(t.link.id, '2026-10-07', '0.00');
    expect((await report.report(range, own())).rows[0]).toMatchObject({ expectedCostDays: 3, recordedCostDays: 3, costCoverageComplete: true, orderCpaUsd: '50.00' });
    await costs.voidCost(six.id, 0, writer());
    expect((await report.report(range, own())).rows[0]).toMatchObject({ recordedCostDays: 2, costCoverageComplete: false });
    expect((await report.report(query({ from: '2026-10-07', to: '2026-10-07', linkIds: [t.link.id] }), own())).rows[0]).toMatchObject({ spendUsd: '0.00', spendPhp: '0.00', costCoverageComplete: true, orderRoas: null });
  });

  it('separates DIRECT, verified legacy and missing-touch historical orders from registered-link return', async () => {
    const t = await target();
    await order(t, { shipments: ['2026-10-12T01:00:00Z'] });
    await order(t, { source: 'DIRECT', value: '99999.00', shipments: ['2026-10-12T01:00:00Z'] });
    await order(t, { source: 'LEGACY', value: '88888.00' });
    await order(t, { source: 'UNVERIFIED', value: '77777.00', createdAt: '2026-10-04T16:00:00Z' });
    await expense(t.link.id);
    const result = await report.report(query({ landingPageId: t.page.id }), own());
    expect(result.rows.find(row => row.id === t.link.id)).toMatchObject({ signedGrossPhp: '10000.00', signedOrders: 1, signedRoas: '3.49' });
    expect(result.otherSources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'DIRECT', validOrderValuePhp: '99999.00', orderRoas: null, visits: null }), expect.objectContaining({ kind: 'LEGACY', validOrderValuePhp: '88888.00', orderRoas: null }), expect.objectContaining({ kind: 'UNVERIFIED', validOrderValuePhp: '77777.00', periodBasis: 'ORDER_CREATED' })]));
  });

  it('independently deduplicates two links into page, product and owner daily-session visits', async () => {
    const t = await target();
    const second = await prisma.campaignLink.create({ data: { productId, landingPageId: t.page.id, ownerUserId: ownerId, aidSnapshot: 'REPORT-OWNER', name: 'Report ad B', code: randomUUID().replaceAll('-', '').slice(0, 16), sourceType: 'META_AD', createdAt: new Date('2026-10-03T16:00:00Z') } });
    for (const linkId of [t.link.id, second.id]) await prisma.campaignLinkVisit.create({ data: { linkId, visitKey: 'same-tab', visitDay: new Date('2026-10-05T00:00:00Z'), createdAt: new Date('2026-10-04T16:00:00Z') } });
    await prisma.landingPageVisit.createMany({ data: ['same-tab', 'direct-tab'].map(visitKey => ({ landingPageId: t.page.id, visitKey, visitDay: new Date('2026-10-05T00:00:00Z') })) });
    const selected = { linkIds: [t.link.id, second.id] };
    const links = await report.report(query(selected), own());
    expect(links.rows.map(row => row.visits)).toEqual([1, 1]);
    const pages = await report.report(query({ ...selected, groupBy: 'PAGE' }), own());
    expect(pages.rows).toHaveLength(1); expect(pages.rows[0]).toMatchObject({ visits: 1, pageTotalVisits: 2 });
    for (const groupBy of ['PRODUCT', 'OWNER']) expect((await report.report(query({ ...selected, groupBy }), own())).rows[0]).toMatchObject({ visits: 1 });
  });

  it('uses Manila touch boundaries rather than order creation and keeps owner scopes private', async () => {
    const t = await target();
    await order(t, { touchedAt: '2026-10-04T15:59:59.999Z' });
    await order(t, { touchedAt: '2026-10-04T16:00:00.000Z' });
    await order(t, { touchedAt: '2026-10-05T15:59:59.999Z' });
    await order(t, { touchedAt: '2026-10-05T16:00:00.000Z' });
    expect((await report.report(query({ linkIds: [t.link.id] }), own())).rows[0]).toMatchObject({ submittedOrders: 2 });
    const foreign = { id: otherId, permissions: ['MARKETING_VIEW_OWN'] };
    expect((await report.report(query({ productId }), foreign)).rows).toEqual([]);
    await expect(report.report(query({ linkIds: [t.link.id] }), foreign)).rejects.toMatchObject({ status: 404 });
    await expect(report.report(query({ ownerUserId: ownerId }), foreign)).rejects.toMatchObject({ status: 404 });
    expect((await report.report(query({ linkIds: [t.link.id] }), { id: otherId, permissions: ['MARKETING_VIEW_ALL'] })).rows[0]).toMatchObject({ submittedOrders: 2 });
  });
});
