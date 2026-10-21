import { describe, expect, it } from 'vitest';
import {
  averageOrderValue,
  conversionRate,
  estimateStockout,
  fillDailySeries,
  grossProfit,
  groupLocations,
  netSales,
  normalizeProvince,
  percentChange,
  pickAcrossIssues,
  refundRate,
  rate,
  type OrderWindowFacts,
} from './dashboard-metrics.js';
import { resolveWindow } from './dashboard-range.js';

function facts(overrides: Partial<OrderWindowFacts> = {}): OrderWindowFacts {
  return {
    validOrders: 0,
    grossProductSales: 0,
    discountTotal: 0,
    refundedAmount: 0,
    refundedOrders: 0,
    cancelledOrders: 0,
    signedOrders: 0,
    confirmedOrders: 0,
    customers: 0,
    ...overrides,
  };
}

describe('netSales', () => {
  it('subtracts discounts and full refunds from product sales', () => {
    expect(
      netSales(
        facts({ grossProductSales: 10000, discountTotal: 500, refundedAmount: 1200 }),
      ),
    ).toBe(8300);
  });

  it('never reports negative sales when refunds exceed the period', () => {
    expect(netSales(facts({ grossProductSales: 100, discountTotal: 0, refundedAmount: 200 }))).toBe(0);
  });
});

describe('averageOrderValue', () => {
  it('divides net sales by valid orders', () => {
    expect(averageOrderValue(1000, 4)).toBe(250);
  });

  it('is null instead of zero when there are no orders', () => {
    expect(averageOrderValue(1000, 0)).toBeNull();
  });
});

describe('conversionRate', () => {
  it('divides ordering sessions by sessions', () => {
    expect(conversionRate(3, 120)).toBe(0.025);
  });

  it('is null when no session was recorded', () => {
    expect(conversionRate(0, 0)).toBeNull();
  });
});

describe('refundRate', () => {
  it('uses the count of refunded orders over valid orders', () => {
    expect(refundRate(2, 40)).toBe(0.05);
  });

  it('is null below one valid order', () => {
    expect(refundRate(0, 0)).toBeNull();
  });
});

describe('rate', () => {
  it('rounds a ratio to four decimals', () => {
    expect(rate(3, 7)).toBe(0.4286);
    expect(rate(0, 10)).toBe(0);
  });

  it('is null when the denominator is zero', () => {
    expect(rate(0, 0)).toBeNull();
  });
});

describe('pickAcrossIssues', () => {
  const row = (issue: string, id: string) => ({ issue, id });

  it('gives every detected issue type a slot before repeating one', () => {
    const picked = pickAcrossIssues([
      row('OUT_OF_STOCK', 'a'),
      row('OUT_OF_STOCK', 'b'),
      row('OUT_OF_STOCK', 'c'),
      row('LOW_CONVERSION', 'd'),
    ]);

    // The out-of-stock rows would fill every slot on their own; the low
    // conversion row still gets one.
    expect(picked.map((item) => item.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('fills the remaining slots by severity', () => {
    const picked = pickAcrossIssues([
      row('LOW_TRAFFIC', 't1'),
      row('LOW_TRAFFIC', 't2'),
      row('OUT_OF_STOCK', 'o1'),
      row('OUT_OF_STOCK', 'o2'),
      row('OUT_OF_STOCK', 'o3'),
    ]);

    expect(picked.map((item) => item.issue)).toEqual([
      'OUT_OF_STOCK',
      'LOW_TRAFFIC',
      'OUT_OF_STOCK',
      'LOW_TRAFFIC',
      'OUT_OF_STOCK',
    ]);
  });

  it('never returns more rows than the limit', () => {
    const flagged = Array.from({ length: 30 }, (_, index) =>
      row('OUT_OF_STOCK', `s${index}`),
    );
    expect(pickAcrossIssues(flagged, 8)).toHaveLength(8);
  });
});

describe('grossProfit', () => {
  it('withholds profit while any order line lacks a cost snapshot', () => {
    const result = grossProfit(1000, {
      productCost: 400,
      shippingCost: 50,
      paymentFee: 10,
      itemLines: 10,
      costedItemLines: 9,
    });
    expect(result.value).toBeNull();
    expect(result.productCostComplete).toBe(false);
    expect(result.costCoverage).toBe(0.9);
    expect(result.missing).toContain('PRODUCT_COST');
  });

  it('computes profit when every line is costed', () => {
    const result = grossProfit(1000, {
      productCost: 400,
      shippingCost: 50,
      paymentFee: 10,
      itemLines: 10,
      costedItemLines: 10,
    });
    expect(result.value).toBe(540);
    expect(result.productCostComplete).toBe(true);
  });

  it('flags shipping and payment fees that were never recorded', () => {
    const result = grossProfit(1000, {
      productCost: 400,
      shippingCost: 0,
      paymentFee: 0,
      itemLines: 1,
      costedItemLines: 1,
    });
    expect(result.missing).toEqual(['SHIPPING_COST', 'PAYMENT_FEE']);
  });
});

describe('percentChange', () => {
  it('reports a signed percentage against the previous window', () => {
    expect(percentChange(120, 100)).toEqual({ percent: 20, direction: 'UP' });
    expect(percentChange(80, 100)).toEqual({ percent: -20, direction: 'DOWN' });
  });

  it('marks growth from zero without inventing a percentage', () => {
    expect(percentChange(50, 0)).toEqual({ percent: null, direction: 'UP' });
  });

  it('is unknown when there is no previous window', () => {
    expect(percentChange(50, null).direction).toBe('UNKNOWN');
  });
});

describe('estimateStockout', () => {
  const oldSku = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date('2026-10-21T00:00:00.000Z');

  it('divides available units by the daily sales pace', () => {
    expect(estimateStockout(14, 7, 7, oldSku, now).days).toBe(14);
  });

  it('reports out-of-stock without dividing', () => {
    const result = estimateStockout(0, 7, 7, oldSku, now);
    expect(result).toMatchObject({ days: 0, status: 'OUT_OF_STOCK' });
  });

  it('refuses to estimate for a SKU with no sales in the window', () => {
    expect(estimateStockout(9, 0, 7, oldSku, now)).toMatchObject({
      days: null,
      status: 'NO_RECENT_SALES',
    });
  });

  it('refuses to estimate for a SKU younger than the window', () => {
    expect(estimateStockout(9, 1, 30, new Date('2026-10-10T00:00:00.000Z'), now)).toMatchObject({
      days: null,
      status: 'NEW_SKU',
    });
  });
});

describe('normalizeProvince', () => {
  it('merges the NCR spellings Metro Manila is written with', () => {
    expect(normalizeProvince('NCR')).toBe('Metro Manila');
    expect(normalizeProvince('  metro   manila ')).toBe('Metro Manila');
    expect(normalizeProvince('National Capital Region')).toBe('Metro Manila');
  });

  it('leaves other provinces untouched', () => {
    expect(normalizeProvince('Cebu')).toBe('Cebu');
    expect(normalizeProvince('')).toBe('Unspecified');
  });
});

describe('groupLocations', () => {
  it('returns the top provinces plus an Others bucket', () => {
    const rows = [
      { province: 'Cebu', orders: 4, revenue: 400 },
      { province: 'NCR', orders: 6, revenue: 600 },
      { province: 'Cavite', orders: 3, revenue: 300 },
      { province: 'Laguna', orders: 2, revenue: 200 },
      { province: 'Rizal', orders: 1, revenue: 100 },
      { province: 'Batangas', orders: 1, revenue: 100 },
    ];
    const grouped = groupLocations(rows, 5);
    expect(grouped.total).toBe(17);
    expect(grouped.rows[0]).toMatchObject({ province: 'Metro Manila', orders: 6 });
    expect(grouped.rows.at(-1)).toMatchObject({ province: 'Others', orders: 1 });
  });
});

describe('fillDailySeries', () => {
  it('creates one point per calendar day, including empty days', () => {
    const window = resolveWindow('LAST_7_DAYS', undefined, undefined, new Date('2026-10-21T02:00:00.000Z'));
    const series = fillDailySeries([{ day: '2026-10-21', revenue: 500, orders: 2 }], window);
    expect(series).toHaveLength(7);
    expect(series.at(-1)).toMatchObject({ day: '2026-10-21', revenue: 500, orders: 2 });
    expect(series[0]).toMatchObject({ day: '2026-10-15', revenue: 0, orders: 0 });
  });
});
