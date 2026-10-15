import { createMarketingTestPrisma, marketingTestDatabase } from '../../../test/marketing-test-prisma.js';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { OrderStatus } from '../../generated/prisma/client.js';
import { AdCostsService } from './ad-costs.service.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { OptimizersService } from './optimizers.service.js';
import { MarketingPerformanceService } from './marketing-performance.service.js';
import { MarketingReportService } from './marketing-report.service.js';
import { marketingPerformanceQuerySchema } from './dto/marketing-performance.dto.js';

const database = marketingTestDatabase();

describe.skipIf(!database)('marketing performance PostgreSQL aggregates', () => {
  let prisma: PrismaService;
  let performance: MarketingPerformanceService;
  let report: MarketingReportService;
  let costs: AdCostsService;
  let optimizers: OptimizersService;
  let ownerId = ''; let otherId = ''; let financeId = ''; let inactiveId = '';
  let categoryId = ''; let productId = ''; let secondProductId = '';
  let customerId = ''; let warehouseId = '';
  let pageAlpha!: { id: string }; let pageBravo!: { id: string }; let pageCharlie!: { id: string };
  let pageDelta!: { id: string }; let pageEcho!: { id: string }; let pageFoxtrot!: { id: string };
  let pageGolf!: { id: string }; let pageRetired!: { id: string };
  let linkAlpha1!: { id: string }; let linkAlpha2!: { id: string }; let linkBravo!: { id: string };
  let linkCharlie!: { id: string }; let linkGolf!: { id: string };
  let linkRetired!: { id: string }; let directLink!: { id: string };
  const createdProductIds: string[] = [];
  const tag = randomUUID();
  const own = () => ({ id: ownerId, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });
  const allRead = () => ({ id: financeId, permissions: ['MARKETING_VIEW_ALL'] });
  const writer = () => ({ id: ownerId, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });
  const query = (extra: Record<string, unknown> = {}) => marketingPerformanceQuerySchema.parse({ view: 'PRODUCT', productId, preset: 'CUSTOM', from: '2026-10-05', to: '2026-10-07', ...extra });
  const now = new Date('2026-10-13T01:00:00Z');

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  beforeAll(async () => {
    prisma = createMarketingTestPrisma(database!); await prisma.$connect();
    performance = new MarketingPerformanceService(prisma);
    report = new MarketingReportService(prisma);
    optimizers = new OptimizersService(prisma);
    costs = new AdCostsService(prisma, new CampaignLinksService(prisma, optimizers));
    const suffix = tag.slice(0, 8).toUpperCase();
    ownerId = (await prisma.user.create({ data: { name: 'Performance owner', email: `perf-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    otherId = (await prisma.user.create({ data: { name: 'Performance other', email: `perf-other-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    financeId = (await prisma.user.create({ data: { name: 'Performance finance', email: `perf-finance-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    inactiveId = (await prisma.user.create({ data: { name: 'Retired optimizer', email: `perf-retired-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    await prisma.optimizerProfile.create({ data: { userId: ownerId, aid: `PERF${suffix}`, displayName: 'Performance owner' } });
    await prisma.optimizerProfile.create({ data: { userId: inactiveId, aid: `RETIRED${suffix}`, displayName: 'Retired optimizer', status: 'DISABLED' } });
    categoryId = (await prisma.category.create({ data: { name: 'Performance integration', slug: `perf-${tag}` } })).id;
    productId = (await prisma.product.create({ data: { categoryId, name: 'Performance parent', productCode: `PERF-${tag}`, slug: `perf-${tag}`, status: 'ACTIVE', solutions: [] } })).id;
    secondProductId = (await prisma.product.create({ data: { categoryId, name: 'Performance second', productCode: `PERF2-${tag}`, slug: `perf2-${tag}`, status: 'ACTIVE', solutions: [] } })).id;
    createdProductIds.push(productId, secondProductId);
    customerId = (await prisma.customer.create({ data: { name: 'Private performance customer', normalizedPhone: `perf-fixture-${tag}` } })).id;
    warehouseId = (await prisma.warehouse.create({ data: { name: `Performance warehouse ${tag}` } })).id;
    pageAlpha = await makePage(ownerId, productId, 'Alpha page');
    pageBravo = await makePage(ownerId, productId, 'Bravo page');
    pageCharlie = await makePage(otherId, productId, 'Charlie page');
    pageDelta = await makePage(ownerId, productId, 'Delta draft', 'DRAFT');
    pageEcho = await makePage(ownerId, productId, 'Echo disabled', 'DISABLED');
    pageFoxtrot = await makePage(null, productId, 'Foxtrot unassigned');
    pageGolf = await makePage(ownerId, secondProductId, 'Golf second product');
    pageRetired = await makePage(inactiveId, secondProductId, 'Retired history page');
    linkAlpha1 = await makeLink(ownerId, productId, pageAlpha.id, 'Alpha ad 1');
    linkAlpha2 = await makeLink(ownerId, productId, pageAlpha.id, 'Alpha ad 2');
    linkBravo = await makeLink(ownerId, productId, pageBravo.id, 'Bravo ad');
    linkCharlie = await makeLink(otherId, productId, pageCharlie.id, 'Charlie ad');
    await makeLink(ownerId, productId, pageEcho.id, 'Echo ad');
    linkGolf = await makeLink(ownerId, secondProductId, pageGolf.id, 'Golf ad');
    linkRetired = await makeLink(inactiveId, secondProductId, pageRetired.id, 'Retired ad');
    directLink = await makeLink(ownerId, productId, null, 'Direct product ad');
    for (const link of [linkAlpha1, linkAlpha2, linkBravo, linkCharlie]) await visit(link.id, `same-${tag}`, '2026-10-05');
    await visit(linkAlpha1.id, `same-${tag}`, '2026-10-06');
    await visit(linkBravo.id, `second-${tag}`, '2026-10-06');
    await visit(linkGolf.id, `same-${tag}`, '2026-10-05');
    await visit(directLink.id, `direct-${tag}`, '2026-10-05');
    await visit(directLink.id, `direct-${tag}`, '2026-10-06');
    await prisma.landingPageVisit.createMany({ data: [`same-${tag}`, `lp2-${tag}`].map(visitKey => ({ landingPageId: pageAlpha.id, visitKey, visitDay: new Date('2026-10-05T00:00:00Z') })) });
    await prisma.landingPageVisit.create({ data: { landingPageId: pageDelta.id, visitKey: `draft-${tag}`, visitDay: new Date('2026-10-05T00:00:00Z') } });
    await order({ linkId: directLink.id, pageId: null, product: productId, source: 'DIRECT' }, { value: '99999.00', shipments: ['2026-10-12T01:00:00Z'] });
    await order({ linkId: null, pageId: pageAlpha.id, product: productId, source: 'LEGACY' }, { value: '88888.00' });
    await order({ linkId: null, pageId: pageAlpha.id, product: productId, source: 'UNVERIFIED' }, { value: '77777.00', createdAt: '2026-10-04T16:00:00Z' });
  }, 30000);

  afterAll(async () => {
    if (!prisma) return;
    if (customerId) { await prisma.shipment.deleteMany({ where: { order: { customerId } } }); await prisma.order.deleteMany({ where: { customerId } }); await prisma.customer.delete({ where: { id: customerId } }); }
    for (const id of createdProductIds) {
      await prisma.adCostAudit.deleteMany({ where: { cost: { link: { productId: id } } } });
      await prisma.adCostEntry.deleteMany({ where: { link: { productId: id } } });
      await prisma.campaignLinkVisit.deleteMany({ where: { link: { productId: id } } });
      await prisma.campaignLink.deleteMany({ where: { productId: id } });
      await prisma.landingPageVisit.deleteMany({ where: { landingPage: { productId: id } } });
      await prisma.productLandingPage.deleteMany({ where: { productId: id } });
      await prisma.product.delete({ where: { id } });
    }
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    if (warehouseId) await prisma.warehouse.delete({ where: { id: warehouseId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId, financeId, inactiveId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  async function makePage(owner: string | null, product: string, name: string, status: 'DRAFT' | 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
    return prisma.productLandingPage.create({ data: { productId: product, ownerUserId: owner, name, slug: `perf-${randomUUID()}`, status } });
  }
  async function makeLink(owner: string, product: string, landingPageId: string | null, name: string, createdAt = '2026-10-03T16:00:00Z') {
    return prisma.campaignLink.create({ data: { productId: product, landingPageId, ownerUserId: owner, aidSnapshot: 'PERF-OWNER', name, code: randomUUID().replaceAll('-', '').slice(0, 16), sourceType: 'META_AD', createdAt: new Date(createdAt) } });
  }
  async function visit(linkId: string, visitKey: string, day: string) {
    return prisma.campaignLinkVisit.create({ data: { linkId, visitKey, visitDay: new Date(`${day}T00:00:00Z`), createdAt: new Date('2026-10-04T16:00:00Z') } });
  }
  async function order(destination: { linkId: string | null; pageId: string | null; product: string; optimizer?: string; source?: 'REGISTERED' | 'DIRECT' | 'LEGACY' | 'UNVERIFIED' }, extra: { status?: OrderStatus; value?: string; touchedAt?: string | null; createdAt?: string; shipments?: (string | null)[]; confirmationHistory?: boolean } = {}) {
    const source = destination.source ?? 'REGISTERED';
    const value = extra.value ?? '10000.00';
    const row = await prisma.order.create({ data: {
      orderNumber: `PERF-${randomUUID()}`, customerId, subtotal: value, discountTotal: 0, shippingTotal: 0, grandTotal: value, orderStatus: extra.status ?? 'SHIPPING', paymentStatus: 'COD_PENDING', createdAt: new Date(extra.createdAt ?? '2026-10-06T01:00:00Z'), customerClassification: 'NEW',
      attribution: { create: { optimizerId: destination.optimizer ?? ownerId, aidSnapshot: 'PERF-OWNER', ownerNameSnapshot: 'Performance owner', productId: destination.product, productNameSnapshot: 'Performance parent', sourceType: source === 'DIRECT' ? 'DIRECT' : 'META_AD', linkId: source === 'REGISTERED' ? destination.linkId : null, landingPageId: destination.pageId, touchedAt: source === 'UNVERIFIED' ? null : new Date(extra.touchedAt ?? '2026-10-04T16:30:00Z'), legacy: source === 'UNVERIFIED' ? null : source === 'LEGACY' } },
      ...(extra.confirmationHistory ? { statusHistory: { create: { statusDomain: 'CONFIRMATION_STATUS', newStatus: 'CONFIRMED', source: 'ADMIN' } } } : {}),
    } });
    for (const signedAt of extra.shipments ?? []) await prisma.shipment.create({ data: { orderId: row.id, warehouseId, carrier: 'Performance fixture', status: signedAt ? 'SIGNED' : 'SHIPPING', shippedAt: new Date('2026-10-07T01:00:00Z'), signedAt: signedAt ? new Date(signedAt) : null } });
    return row;
  }
  async function expense(linkId: string, costDate: string, amountUsd: string) {
    return costs.upsertCost({ linkId, costDate, amountUsd, phpPerUsd: amountUsd === '0.00' ? null : '57.3' }, writer());
  }

  it('lists every visible page and deduplicates visits across links', async () => {
    const result = await performance.performance(query({ pageSize: '100' }), allRead());
    expect(result.overview.total).toBe(6);
    expect(result.total).toBe(6);
    const byId = new Map(result.rows.map(row => [row.id, row]));
    expect(byId.get(pageAlpha.id)).toMatchObject({ name: 'Alpha page', ownerUserId: ownerId, ownerName: 'Performance owner', aid: expect.stringMatching(/^PERF/), linkCount: 2, current: { registeredLinkCount: 2, totals: { visits: 2 } } });
    expect(byId.get(pageBravo.id)?.current.totals?.visits).toBe(2);
    expect(byId.get(pageCharlie.id)).toMatchObject({ ownerUserId: otherId, ownerName: 'Performance other', aid: null, current: { totals: { visits: 1 } } });
    expect(byId.get(pageEcho.id)).toMatchObject({ current: { registeredLinkCount: 1, totals: { visits: 0 } } });
    expect(byId.get(pageEcho.id)?.notices).toEqual(expect.arrayContaining(['NO_TRAFFIC', 'COSTS_INCOMPLETE']));
    expect(byId.get(pageDelta.id)).toMatchObject({ linkCount: 0, current: { registeredLinkCount: 0, totals: null }, pageTotalVisits: 1 });
    expect(byId.get(pageDelta.id)?.notices).toEqual(expect.arrayContaining(['NO_LINKS']));
    expect(byId.get(pageFoxtrot.id)).toMatchObject({ ownerUserId: null, ownerName: null, notices: ['NO_LINKS'] });
    const rowVisitSum = result.rows.reduce((sum, row) => sum + (row.current.totals?.visits ?? 0), 0);
    expect(rowVisitSum).toBe(5);
    expect(result.current).toMatchObject({ registeredLinkCount: 5, totals: { visits: 3, pageTotalVisits: 3, costCoverageComplete: false, orderCpaUsd: null, signedRoas: null, spendUsd: '0.00' } });
    expect(JSON.stringify(result)).not.toContain('Private performance customer');
  });

  it('keeps direct product links out of page aggregates while the link report still reads them', async () => {
    const result = await performance.performance(query({ pageSize: '100' }), allRead());
    expect(result.current.totals).toMatchObject({ visits: 3, signedGrossPhp: '0.00', validOrderValuePhp: '0.00' });
    expect(result.trend.points.find(point => point.key === '2026-10-05')?.totals?.visits).toBe(1);
    const direct = await report.report({ from: '2026-10-05', to: '2026-10-07', groupBy: 'LINK', productId, page: 1, pageSize: 20 }, own());
    expect(direct.otherSources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'DIRECT', validOrderValuePhp: '99999.00', visits: null })]));
  });

  it('keeps the summary and trend stable across row pages', async () => {
    const first = await performance.performance(query({ pageSize: '2' }), allRead());
    const second = await performance.performance(query({ pageSize: '2', page: '2' }), allRead());
    expect(first.rows.map(row => row.name)).toEqual(['Alpha page', 'Bravo page']);
    expect(second.rows.map(row => row.name)).toEqual(['Charlie page', 'Delta draft']);
    expect(second.total).toBe(6);
    expect(second.current).toEqual(first.current);
    expect(second.trend).toEqual(first.trend);
    expect(second.overview).toEqual(first.overview);
  });

  it('restricts own scope to the actor and hides forged targets', async () => {
    const result = await performance.performance(query({ pageSize: '100' }), own());
    expect(result.total).toBe(4);
    expect(result.rows.map(row => row.name)).toEqual(['Alpha page', 'Bravo page', 'Delta draft', 'Echo disabled']);
    expect(result.current.totals).toMatchObject({ visits: 3 });
    expect(result.scope).toMatchObject({ ownerUserId: ownerId, onlyOwn: true });
    await expect(performance.performance(query({ ownerUserId: otherId }), own())).rejects.toMatchObject({ status: 404 });
    await expect(performance.performance(query({ trendPageId: pageCharlie.id }), own())).rejects.toMatchObject({ status: 404 });
    await expect(performance.performance(query({ landingPageId: pageCharlie.id }), own())).rejects.toMatchObject({ status: 404 });
  });

  it('groups one optimizer across products and requires an explicit choice', async () => {
    const result = await performance.performance(query({ view: 'OPTIMIZER', productId: undefined, ownerUserId: ownerId, pageSize: '100' }), allRead());
    expect(result.total).toBe(5);
    expect(result.overview.byProduct).toEqual([
      { productId, productName: 'Performance parent', productCode: expect.stringMatching(/^PERF-/), pageCount: 4 },
      { productId: secondProductId, productName: 'Performance second', productCode: expect.stringMatching(/^PERF2-/), pageCount: 1 },
    ]);
    expect(result.current.totals).toMatchObject({ visits: 3 });
    expect(result.trend.points.find(point => point.key === '2026-10-05')?.totals?.visits).toBe(1);
    await expect(performance.performance(query({ view: 'OPTIMIZER', productId: undefined }), allRead())).rejects.toMatchObject({ status: 400 });
  });

  it('keeps a disabled optimizer readable without restoring write access', async () => {
    const result = await performance.performance(query({ view: 'OPTIMIZER', productId: undefined, ownerUserId: inactiveId, pageSize: '100' }), allRead());
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({ name: 'Retired history page', ownerUserId: inactiveId, current: { registeredLinkCount: 1, totals: { visits: 0 } } });
    const options = await performance.options({}, allRead());
    expect(options.owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: ownerId, isActive: true, aid: expect.stringMatching(/^PERF/), pageCount: 5 }),
      expect.objectContaining({ userId: inactiveId, isActive: false, aid: expect.stringMatching(/^RETIRED/), pageCount: 1 }),
      expect.objectContaining({ userId: otherId, isActive: true, aid: null, pageCount: 1 }),
    ]));
    await expect(optimizers.ensureProfileForUser(inactiveId)).rejects.toMatchObject({ status: 403 });
    await expect(costs.upsertCost({ linkId: linkRetired.id, costDate: '2026-10-05', amountUsd: '5.00', phpPerUsd: '57.3' }, allRead())).rejects.toMatchObject({ status: 403 });
  });

  it('filters by current effective status and rejects excluded trend targets', async () => {
    const live = await performance.performance(query({ effectiveStatus: 'LIVE', pageSize: '100' }), allRead());
    expect(live.rows.map(row => row.name)).toEqual(['Alpha page', 'Bravo page', 'Charlie page', 'Foxtrot unassigned']);
    expect(live.current.totals).toMatchObject({ visits: 3 });
    const draft = await performance.performance(query({ effectiveStatus: 'DRAFT', pageSize: '100' }), allRead());
    expect(draft.rows.map(row => row.name)).toEqual(['Delta draft']);
    const disabled = await performance.performance(query({ effectiveStatus: 'DISABLED', pageSize: '100' }), allRead());
    expect(disabled.rows.map(row => row.name)).toEqual(['Echo disabled']);
    await expect(performance.performance(query({ effectiveStatus: 'LIVE', trendPageId: pageDelta.id }), allRead())).rejects.toMatchObject({ status: 404 });
  });

  it('returns one page directory and its own trend for the editor step', async () => {
    const result = await performance.performance(query({ landingPageId: pageAlpha.id, trendPageId: pageAlpha.id }), allRead());
    expect(result.total).toBe(1);
    expect(result.current).toMatchObject({ registeredLinkCount: 2, totals: { visits: 2 } });
    expect(result.trend.points.map(point => point.totals?.visits ?? null)).toEqual([1, 1, 0]);
    expect(result.scope).toMatchObject({ landingPageId: pageAlpha.id });
  });

  it('keeps weekly buckets and empty days honest', async () => {
    const daily = await performance.performance(query({ pageSize: '100' }), allRead());
    expect(daily.trend.points.map(point => ({ key: point.key, visits: point.totals?.visits ?? null }))).toEqual([
      { key: '2026-10-05', visits: 1 },
      { key: '2026-10-06', visits: 2 },
      { key: '2026-10-07', visits: 0 },
    ]);
    expect(daily.trend.points[2]).toMatchObject({ registeredLinkCount: 5, totals: { costCoverageComplete: false } });
    const weekly = await performance.performance(query({ interval: 'WEEK', pageSize: '100' }), allRead());
    expect(weekly.trend.points).toEqual([
      expect.objectContaining({ key: '2026-10-05', from: '2026-10-05', to: '2026-10-07', partialWeek: true, includesToday: false }),
    ]);
    expect(weekly.trend.points[0].totals).toMatchObject({ visits: 3 });
  });

  it('keeps pages whose links start after the period without faking zero performance', async () => {
    const lateProduct = await prisma.product.create({ data: { categoryId, name: 'Performance late', productCode: `PERFLATE-${tag}`, slug: `perflate-${tag}`, status: 'ACTIVE', solutions: [] } });
    createdProductIds.push(lateProduct.id);
    const page = await makePage(ownerId, lateProduct.id, 'Late campaign page');
    await makeLink(ownerId, lateProduct.id, page.id, 'Late ad', '2026-10-09T16:00:00Z');
    const result = await performance.performance(query({ productId: lateProduct.id, pageSize: '100' }), allRead());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ linkCount: 1, current: { registeredLinkCount: 0, totals: null } });
    expect(result.rows[0].notices).toEqual(['NOT_STARTED']);
    expect(result.current).toMatchObject({ registeredLinkCount: 0, totals: null });
    expect(result.trend.points.every(point => point.totals === null && point.registeredLinkCount === 0)).toBe(true);
  });

  it('books orders into their touch cohort and requires every box signed', async () => {
    const ordersProduct = await prisma.product.create({ data: { categoryId, name: 'Performance orders', productCode: `PERFORD-${tag}`, slug: `perford-${tag}`, status: 'ACTIVE', solutions: [] } });
    createdProductIds.push(ordersProduct.id);
    const page = await makePage(ownerId, ordersProduct.id, 'Orders page');
    const link = await makeLink(ownerId, ordersProduct.id, page.id, 'Orders ad');
    await order({ linkId: link.id, pageId: page.id, product: ordersProduct.id }, { value: '100.00', touchedAt: '2026-10-05T02:00:00Z', shipments: ['2026-10-12T01:00:00Z'], confirmationHistory: true });
    const partial = await order({ linkId: link.id, pageId: page.id, product: ordersProduct.id }, { value: '200.00', touchedAt: '2026-10-05T20:00:00Z', shipments: ['2026-10-12T01:00:00Z', null] });
    await order({ linkId: link.id, pageId: page.id, product: ordersProduct.id }, { status: 'CANCELLED', value: '300.00', touchedAt: '2026-10-05T20:00:00Z' });
    const scoped = () => query({ productId: ordersProduct.id, pageSize: '100' });
    const first = await performance.performance(scoped(), allRead());
    expect(first.current.totals).toMatchObject({ submittedOrders: 3, validOrders: 2, confirmedOrders: 1, signedOrders: 1, validOrderValuePhp: '300.00', signedGrossPhp: '100.00', costCoverageComplete: false, signedRoas: null });
    expect(first.trend.points.map(point => point.totals?.signedOrders ?? null)).toEqual([1, 0, 0]);
    expect(first.trend.points[0].totals).toMatchObject({ signedGrossPhp: '100.00' });
    await prisma.shipment.updateMany({ where: { orderId: partial.id }, data: { status: 'SIGNED', signedAt: new Date('2026-10-12T03:00:00Z') } });
    await expense(link.id, '2026-10-05', '10.00');
    await expense(link.id, '2026-10-06', '0.00');
    await expense(link.id, '2026-10-07', '0.00');
    const second = await performance.performance(scoped(), allRead());
    expect(second.current.totals).toMatchObject({ costCoverageComplete: true, spendUsd: '10.00', orderCpaUsd: '5.00', signedCpaUsd: '5.00', signedGrossPhp: '300.00', signedRoas: '0.52' });
  });

  it('keeps explicit zero, missing days, and decimal totals distinct', async () => {
    const costsProduct = await prisma.product.create({ data: { categoryId, name: 'Performance costs', productCode: `PERFCOST-${tag}`, slug: `perfcost-${tag}`, status: 'ACTIVE', solutions: [] } });
    createdProductIds.push(costsProduct.id);
    const zeroPage = await makePage(ownerId, costsProduct.id, 'Zero cost page');
    const decimalPage = await makePage(ownerId, costsProduct.id, 'Decimal cost page');
    const missingPage = await makePage(ownerId, costsProduct.id, 'Missing cost page');
    const zeroLink = await makeLink(ownerId, costsProduct.id, zeroPage.id, 'Zero ad');
    const decimalLink = await makeLink(ownerId, costsProduct.id, decimalPage.id, 'Decimal ad');
    const missingLink = await makeLink(ownerId, costsProduct.id, missingPage.id, 'Missing ad');
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) await expense(zeroLink.id, day, '0.00');
    await expense(decimalLink.id, '2026-10-05', '0.10');
    await expense(decimalLink.id, '2026-10-06', '0.20');
    await expense(decimalLink.id, '2026-10-07', '0.00');
    await expense(missingLink.id, '2026-10-05', '7.00');
    const result = await performance.performance(query({ productId: costsProduct.id, pageSize: '100' }), allRead());
    const byId = new Map(result.rows.map(row => [row.id, row]));
    expect(byId.get(zeroPage.id)?.current.totals).toMatchObject({ spendUsd: '0.00', spendPhp: '0.00', costCoverageComplete: true, orderCpaUsd: null, orderRoas: null, signedRoas: null });
    expect(byId.get(decimalPage.id)?.current.totals).toMatchObject({ spendUsd: '0.30', costCoverageComplete: true });
    expect(byId.get(missingPage.id)?.current.totals).toMatchObject({ spendUsd: '7.00', recordedCostDays: 1, expectedCostDays: 3, costCoverageComplete: false, orderCpaUsd: null, orderRoas: null });
  });

  it('lists products and owners for the pickers without widening write access', async () => {
    const all = await performance.options({}, allRead());
    expect(all.onlyOwn).toBe(false);
    expect(all.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: productId, pageCount: 6 }),
      expect.objectContaining({ id: secondProductId, pageCount: 2 }),
    ]));
    const ownOptions = await performance.options({}, own());
    expect(ownOptions.onlyOwn).toBe(true);
    expect(ownOptions.owners).toEqual([]);
    expect(ownOptions.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: productId, pageCount: 4 }),
      expect.objectContaining({ id: secondProductId, pageCount: 1 }),
    ]));
  });
});
