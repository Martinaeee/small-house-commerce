import { Prisma } from '../../generated/prisma/client.js';
import { serializeMarketingReportRow, type MarketingReportRawRow, type MarketingReportSerializedRow } from './marketing-report-metrics.js';
import { compareMarketingReportRows, sortMarketingReportRows, type MarketingReportSort, type MarketingReportSortDirection } from './marketing-report-sort.js';

export type MarketingReportVisitRow = { product: string; source: string | null; visits: bigint };

export interface MarketingReportTreeSource {
  sourceType: string;
  totals: MarketingReportSerializedRow;
  links: MarketingReportSerializedRow[];
}
export interface MarketingReportTreeProduct {
  product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null };
  totals: MarketingReportSerializedRow;
  sources: MarketingReportTreeSource[];
}

/** Every additive column of a raw report row, in raw (bigint/Decimal) units. */
interface Totals {
  submittedOrders: bigint; validOrders: bigint; confirmedOrders: bigint; signedOrders: bigint;
  duplicateOrders: bigint; riskOrders: bigint; afterSalesOrders: bigint; refundStatusOrders: bigint;
  addToCarts: bigint; checkouts: bigint;
  validOrderValuePhp: Prisma.Decimal; signedGrossPhp: Prisma.Decimal; spendUsd: Prisma.Decimal; spendPhp: Prisma.Decimal;
  expectedCostDays: bigint; recordedCostDays: bigint;
}
const addKeys = ['submittedOrders', 'validOrders', 'confirmedOrders', 'signedOrders', 'duplicateOrders', 'riskOrders', 'afterSalesOrders', 'refundStatusOrders', 'addToCarts', 'checkouts', 'expectedCostDays', 'recordedCostDays'] as const;
const zero = (): Totals => ({
  submittedOrders: 0n, validOrders: 0n, confirmedOrders: 0n, signedOrders: 0n,
  duplicateOrders: 0n, riskOrders: 0n, afterSalesOrders: 0n, refundStatusOrders: 0n,
  addToCarts: 0n, checkouts: 0n,
  validOrderValuePhp: new Prisma.Decimal(0), signedGrossPhp: new Prisma.Decimal(0),
  spendUsd: new Prisma.Decimal(0), spendPhp: new Prisma.Decimal(0),
  expectedCostDays: 0n, recordedCostDays: 0n,
});
function add(target: Totals, row: MarketingReportRawRow): void {
  for (const key of addKeys) target[key] += row[key];
  target.validOrderValuePhp = target.validOrderValuePhp.plus(row.validOrderValuePhp);
  target.signedGrossPhp = target.signedGrossPhp.plus(row.signedGrossPhp);
  target.spendUsd = target.spendUsd.plus(row.spendUsd);
  target.spendPhp = target.spendPhp.plus(row.spendPhp);
}
function toRaw(totals: Totals, identity: { id: string; label: string; productId: string; productName: string; productCode: string | null; sourceType: string | null }, visits: bigint): MarketingReportRawRow {
  return {
    kind: 'REGISTERED', ownerUserId: null, ownerName: null, aid: null, landingPageId: null,
    pageTotalVisits: null, visits, ...identity, ...totals,
  };
}

/**
 * Product → source-type → link tree. Everything sums up from link rows except
 * visits: one tab can register under two links of the same product on the same
 * day, so visit totals come from the deduped GROUPING SETS query instead of
 * being summed from the links.
 */
export function buildMarketingReportTree(rows: MarketingReportRawRow[], visits: MarketingReportVisitRow[], thumbnails: Map<string, string | null>, sortBy: MarketingReportSort, sortDirection: MarketingReportSortDirection): MarketingReportTreeProduct[] {
  const productVisits = new Map<string, bigint>();
  const sourceVisits = new Map<string, bigint>();
  for (const visit of visits) {
    if (visit.source === null) productVisits.set(visit.product, visit.visits);
    else sourceVisits.set(`${visit.product}:${visit.source}`, visit.visits);
  }
  interface SourceNode { sourceType: string; totals: Totals; links: MarketingReportRawRow[] }
  interface ProductNode { id: string; name: string; code: string | null; totals: Totals; sources: Map<string, SourceNode> }
  const products = new Map<string, ProductNode>();
  for (const row of rows) {
    const productId = row.productId ?? '';
    const node = products.get(productId) ?? { id: productId, name: row.productName ?? productId, code: row.productCode, totals: zero(), sources: new Map<string, SourceNode>() };
    add(node.totals, row);
    const sourceType = row.sourceType ?? 'OTHER';
    const source = node.sources.get(sourceType) ?? { sourceType, totals: zero(), links: [] };
    add(source.totals, row);
    source.links.push(row);
    node.sources.set(sourceType, source);
    products.set(productId, node);
  }
  return [...products.values()]
    .map((node): MarketingReportTreeProduct => {
      const thumbnail = thumbnails.get(node.id) ?? null;
      const sources: MarketingReportTreeSource[] = [...node.sources.values()].map(source => {
        const sourceRaw = toRaw(source.totals, { id: `${node.id}:${source.sourceType}`, label: source.sourceType, productId: node.id, productName: node.name, productCode: node.code, sourceType: source.sourceType }, sourceVisits.get(`${node.id}:${source.sourceType}`) ?? 0n);
        return { sourceType: source.sourceType, totals: serializeMarketingReportRow(sourceRaw, thumbnail), links: sortMarketingReportRows(source.links.map(link => serializeMarketingReportRow(link, thumbnail)), sortBy, sortDirection) };
      });
      sources.sort((a, b) => compareMarketingReportRows(a.totals, b.totals, sortBy, sortDirection) || a.sourceType.localeCompare(b.sourceType));
      const productRaw = toRaw(node.totals, { id: node.id, label: node.name, productId: node.id, productName: node.name, productCode: node.code, sourceType: null }, productVisits.get(node.id) ?? 0n);
      return {
        product: { id: node.id, name: node.name, productCode: node.code, thumbnailUrl: thumbnail },
        totals: serializeMarketingReportRow(productRaw, thumbnail),
        sources,
      };
    })
    .sort((a, b) => compareMarketingReportRows(a.totals, b.totals, sortBy, sortDirection) || a.product.name.localeCompare(b.product.name, 'zh'));
}
