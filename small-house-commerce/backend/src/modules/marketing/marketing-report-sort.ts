/**
 * Sort keys the report API exposes, in the order the UI lists them.
 * Derived ratios keep their null state (a report row without spend or
 * without visits has no honest ratio), so they sort like other nulls.
 */
export const marketingReportSortValues = [
  'NAME', 'PRODUCT', 'OWNER',
  'VISITS', 'ADD_TO_CARTS', 'CHECKOUTS', 'SUBMITTED', 'VALID', 'CONFIRMED', 'SIGNED',
  'VALID_VALUE', 'SIGNED_GROSS', 'SPEND_USD', 'SPEND_PHP',
  'ORDER_CPA', 'SIGNED_CPA', 'ORDER_ROAS', 'SIGNED_ROAS', 'CONVERSION',
] as const;
export type MarketingReportSort = (typeof marketingReportSortValues)[number];
export type MarketingReportSortDirection = 'ASC' | 'DESC';

/** Shape any serialized report row must have to be sortable. The real
 *  serializer (marketing-report-metrics.ts) produces a superset. */
export interface SortableReportRow {
  id: string;
  label: string;
  ownerName: string | null;
  productName: string | null;
  visits: number | null;
  addToCarts: number;
  checkouts: number;
  submittedOrders: number;
  validOrders: number;
  confirmedOrders: number;
  signedOrders: number;
  validOrderValuePhp: string;
  signedGrossPhp: string;
  spendUsd: string;
  spendPhp: string;
  orderCpaUsd: string | null;
  signedCpaUsd: string | null;
  orderRoas: string | null;
  signedRoas: string | null;
  conversionRate: string | null;
}

type SortValue = string | number | null;

/** Column value for a sort key. Monetary strings convert to numbers so
 *  '9.00' cannot outrank '100.00'. */
export function marketingReportSortValue(row: SortableReportRow, sortBy: MarketingReportSort): SortValue {
  switch (sortBy) {
    case 'NAME': return row.label;
    case 'PRODUCT': return row.productName;
    case 'OWNER': return row.ownerName;
    case 'VISITS': return row.visits;
    case 'ADD_TO_CARTS': return row.addToCarts;
    case 'CHECKOUTS': return row.checkouts;
    case 'SUBMITTED': return row.submittedOrders;
    case 'VALID': return row.validOrders;
    case 'CONFIRMED': return row.confirmedOrders;
    case 'SIGNED': return row.signedOrders;
    case 'VALID_VALUE': return Number(row.validOrderValuePhp);
    case 'SIGNED_GROSS': return Number(row.signedGrossPhp);
    case 'SPEND_USD': return Number(row.spendUsd);
    case 'SPEND_PHP': return Number(row.spendPhp);
    case 'ORDER_CPA': return row.orderCpaUsd === null ? null : Number(row.orderCpaUsd);
    case 'SIGNED_CPA': return row.signedCpaUsd === null ? null : Number(row.signedCpaUsd);
    case 'ORDER_ROAS': return row.orderRoas === null ? null : Number(row.orderRoas);
    case 'SIGNED_ROAS': return row.signedRoas === null ? null : Number(row.signedRoas);
    case 'CONVERSION': return row.conversionRate === null ? null : Number(row.conversionRate);
  }
}

/**
 * Order rule for the report and the tree's product/source/link levels:
 * nulls last in both directions, ties broken by id ascending so a page
 * boundary can never reshuffle equal rows.
 */
export function compareMarketingReportRows(a: SortableReportRow, b: SortableReportRow, sortBy: MarketingReportSort, direction: MarketingReportSortDirection): number {
  const factor = direction === 'DESC' ? -1 : 1;
  const av = marketingReportSortValue(a, sortBy);
  const bv = marketingReportSortValue(b, sortBy);
  if (av === null && bv === null) return a.id.localeCompare(b.id);
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = typeof av === 'number' && typeof bv === 'number'
    ? av - bv
    : String(av).localeCompare(String(bv), 'zh');
  return cmp === 0 ? a.id.localeCompare(b.id) : cmp * factor;
}

export function sortMarketingReportRows<Row extends SortableReportRow>(rows: Row[], sortBy: MarketingReportSort, direction: MarketingReportSortDirection): Row[] {
  return [...rows].sort((a, b) => compareMarketingReportRows(a, b, sortBy, direction));
}
