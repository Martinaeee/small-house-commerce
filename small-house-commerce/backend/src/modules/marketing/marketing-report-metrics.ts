import { Prisma } from '../../generated/prisma/client.js';
import type { PerformanceChange, PerformanceTotals } from './marketing-performance.types.js';

const countFields = ['submittedOrders', 'validOrders', 'confirmedOrders', 'signedOrders', 'duplicateOrders', 'riskOrders', 'afterSalesOrders', 'refundStatusOrders'] as const;
type CountField = typeof countFields[number];
export type MarketingReportRawRow = Record<CountField, bigint> & {
  kind: 'REGISTERED' | 'DIRECT' | 'LEGACY' | 'UNVERIFIED'; id: string; label: string;
  ownerUserId: string | null; ownerName: string | null; aid: string | null;
  productId: string | null; productName: string | null; productCode: string | null; landingPageId: string | null;
  visits: bigint | null; pageTotalVisits: bigint | null;
  validOrderValuePhp: Prisma.Decimal; signedGrossPhp: Prisma.Decimal; spendUsd: Prisma.Decimal; spendPhp: Prisma.Decimal;
  expectedCostDays: bigint; recordedCostDays: bigint;
};

export function serializeMarketingReportRow(row: MarketingReportRawRow) {
  const registered = row.kind === 'REGISTERED';
  const expectedCostDays = Number(row.expectedCostDays);
  const recordedCostDays = Number(row.recordedCostDays);
  const costCoverageComplete = registered && recordedCostDays === expectedCostDays;
  const usd = new Prisma.Decimal(row.spendUsd);
  const php = new Prisma.Decimal(row.spendPhp);
  const ratios = registered && costCoverageComplete && recordedCostDays > 0;
  const ratio = (numerator: Prisma.Decimal | number, denominator: Prisma.Decimal | number) => new Prisma.Decimal(numerator).div(denominator).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  const counts = Object.fromEntries(countFields.map(key => [key, Number(row[key])])) as Record<CountField, number>;
  const visits = registered && row.visits !== null ? Number(row.visits) : null;
  return {
    kind: row.kind, id: row.id, label: row.label, ownerUserId: row.ownerUserId, ownerName: row.ownerName, aid: row.aid,
    productId: row.productId, productName: row.productName, productCode: row.productCode, landingPageId: row.landingPageId,
    ...counts, visits, pageTotalVisits: row.pageTotalVisits === null ? null : Number(row.pageTotalVisits),
    validOrderValuePhp: new Prisma.Decimal(row.validOrderValuePhp).toFixed(2), signedGrossPhp: new Prisma.Decimal(row.signedGrossPhp).toFixed(2),
    spendUsd: usd.toFixed(2), spendPhp: php.toFixed(2), expectedCostDays, recordedCostDays, costCoverageComplete,
    orderCpaUsd: ratios && usd.gt(0) && counts.validOrders > 0 ? ratio(usd, counts.validOrders) : null,
    signedCpaUsd: ratios && usd.gt(0) && counts.signedOrders > 0 ? ratio(usd, counts.signedOrders) : null,
    orderRoas: ratios && php.gt(0) ? ratio(row.validOrderValuePhp, php) : null,
    signedRoas: ratios && php.gt(0) ? ratio(row.signedGrossPhp, php) : null,
    conversionRate: visits !== null && visits > 0 ? new Prisma.Decimal(counts.validOrders).div(visits).toFixed(4) : null,
    periodBasis: row.kind === 'UNVERIFIED' ? 'ORDER_CREATED' as const : 'TOUCH' as const,
  };
}

export function serializeMarketingTotals(row: MarketingReportRawRow): PerformanceTotals {
  const row_ = serializeMarketingReportRow(row);
  return {
    visits: row_.visits,
    pageTotalVisits: row_.pageTotalVisits,
    submittedOrders: row_.submittedOrders,
    validOrders: row_.validOrders,
    confirmedOrders: row_.confirmedOrders,
    signedOrders: row_.signedOrders,
    duplicateOrders: row_.duplicateOrders,
    riskOrders: row_.riskOrders,
    afterSalesOrders: row_.afterSalesOrders,
    refundStatusOrders: row_.refundStatusOrders,
    validOrderValuePhp: row_.validOrderValuePhp,
    signedGrossPhp: row_.signedGrossPhp,
    spendUsd: row_.spendUsd,
    spendPhp: row_.spendPhp,
    expectedCostDays: row_.expectedCostDays,
    recordedCostDays: row_.recordedCostDays,
    costCoverageComplete: row_.costCoverageComplete,
    orderCpaUsd: row_.orderCpaUsd,
    signedCpaUsd: row_.signedCpaUsd,
    orderRoas: row_.orderRoas,
    signedRoas: row_.signedRoas,
    conversionRate: row_.conversionRate,
    periodBasis: row_.periodBasis,
  };
}

export function performanceChange(current: number | string | null, previous: number | string | null, precision: number): PerformanceChange {
  if (current === null || previous === null) return { state: 'UNAVAILABLE', absolute: null, percent: null };
  const now = new Prisma.Decimal(current);
  const before = new Prisma.Decimal(previous);
  const absolute = now.minus(before).toFixed(precision, Prisma.Decimal.ROUND_HALF_UP);
  if (before.isZero()) return { state: now.isZero() ? 'UNCHANGED' : 'NEW', absolute, percent: null };
  return { state: 'COMPARABLE', absolute, percent: now.minus(before).div(before).mul(100).toFixed(2, Prisma.Decimal.ROUND_HALF_UP) };
}
