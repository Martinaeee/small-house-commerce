import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { MarketingReportService } from './marketing-report.service.js';
import { marketingReportQuerySchema } from './dto/marketing-report.dto.js';

const OWNER = '11111111-1111-4111-a111-111111111111';
const LINK = '33333333-3333-4333-a333-333333333333';
const account = { id: OWNER, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] };
const query = { from: '2026-10-05', to: '2026-10-05', groupBy: 'LINK' as const, page: 1, pageSize: 20 };
const raw = { kind: 'REGISTERED', id: LINK, label: 'Ad A', ownerUserId: OWNER, ownerName: 'Optimizer', aid: 'OP-1', productId: null, productName: null, productCode: null, landingPageId: null, visits: 2n, pageTotalVisits: null, submittedOrders: 2n, validOrders: 2n, confirmedOrders: 1n, signedOrders: 1n, validOrderValuePhp: new Prisma.Decimal('10000'), signedGrossPhp: new Prisma.Decimal('10000'), spendUsd: new Prisma.Decimal('50'), spendPhp: new Prisma.Decimal('2865'), expectedCostDays: 1n, recordedCostDays: 1n, duplicateOrders: 0n, riskOrders: 0n, afterSalesOrders: 0n, refundStatusOrders: 0n };
function setup(rows = [raw]) {
  const prisma = { $queryRaw: vi.fn(async () => rows), campaignLink: { findMany: vi.fn(async () => [{ id: LINK }]) } };
  return { service: new MarketingReportService(prisma as never), prisma };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T01:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('marketing report monetary projection', () => {
  it('uses saved PHP expenses for ROAS and USD for CPA with Decimal rounding', async () => {
    const { service } = setup();
    const result = await service.report(query, account);
    expect(result.rows[0]).toMatchObject({ spendUsd: '50.00', spendPhp: '2865.00', signedGrossPhp: '10000.00', orderCpaUsd: '25.00', signedCpaUsd: '50.00', orderRoas: '3.49', signedRoas: '3.49', conversionRate: '1.0000', costCoverageComplete: true });
  });

  it('withholds CPA and ROAS for incomplete coverage while preserving recorded sums', async () => {
    const { service } = setup([{ ...raw, expectedCostDays: 3n, recordedCostDays: 2n }]);
    expect((await service.report(query, account)).rows[0]).toMatchObject({ costCoverageComplete: false, spendUsd: '50.00', spendPhp: '2865.00', orderCpaUsd: null, signedCpaUsd: null, orderRoas: null, signedRoas: null, conversionRate: '1.0000' });
  });

  it('returns no cost ratio for zero spend and does not cap repeat-purchase conversion', async () => {
    const { service } = setup([{ ...raw, spendUsd: new Prisma.Decimal(0), spendPhp: new Prisma.Decimal(0), validOrders: 5n }]);
    expect((await service.report(query, account)).rows[0]).toMatchObject({ orderRoas: null, signedRoas: null, orderCpaUsd: null, signedCpaUsd: null, conversionRate: '2.5000' });
  });

  it('returns no CPA or conversion denominator when the corresponding count is zero', async () => {
    const { service } = setup([{ ...raw, visits: 0n, validOrders: 0n, signedOrders: 0n, validOrderValuePhp: new Prisma.Decimal(0), signedGrossPhp: new Prisma.Decimal(0) }]);
    expect((await service.report(query, account)).rows[0]).toMatchObject({ orderCpaUsd: null, signedCpaUsd: null, conversionRate: null, orderRoas: '0.00' });
  });

  it('separates non-link sources, never computes their paid ratios and omits customer fields', async () => {
    const { service } = setup([{ ...raw, kind: 'DIRECT', id: 'DIRECT', privatePhone: 'private-customer' } as typeof raw]);
    const report = await service.report(query, account);
    expect(report.rows).toEqual([]);
    expect(report.otherSources[0]).toMatchObject({ kind: 'DIRECT', orderRoas: null, signedRoas: null, conversionRate: null, periodBasis: 'TOUCH' });
    expect(JSON.stringify(report)).not.toContain('private-customer');
  });

  it('keeps unverifiable history on the order-created basis with unknown visits', async () => {
    const { service } = setup([{ ...raw, kind: 'UNVERIFIED', id: 'UNVERIFIED' } as typeof raw]);
    const report = await service.report(query, account);
    expect(report.rows).toEqual([]);
    expect(report.otherSources[0]).toMatchObject({ kind: 'UNVERIFIED', periodBasis: 'ORDER_CREATED', visits: null });
  });

  it('rejects another owner and inaccessible link IDs before a report read', async () => {
    const { service, prisma } = setup();
    await expect(service.report({ ...query, ownerUserId: LINK }, account)).rejects.toMatchObject({ status: 404 });
    prisma.campaignLink.findMany.mockResolvedValue([]);
    await expect(service.report({ ...query, linkIds: [LINK] }, account)).rejects.toMatchObject({ status: 404 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('defaults to seven Manila dates and rejects invalid, inverted or future ranges', () => {
    expect(marketingReportQuerySchema.parse({})).toMatchObject({ from: '2026-10-07', to: '2026-10-13', groupBy: 'LINK' });
    for (const input of [{ from: '2026-02-30' }, { from: '2026-10-12', to: '2026-10-11' }, { to: '2026-10-14' }, { linkIds: 'not-a-uuid' }]) expect(marketingReportQuerySchema.safeParse(input).success).toBe(false);
  });
});
