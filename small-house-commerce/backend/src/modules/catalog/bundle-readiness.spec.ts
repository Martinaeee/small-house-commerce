import { describe, expect, it } from 'vitest';
import {
  findBundlePublishIssues,
  type BundlePublishRow,
} from './bundle-readiness.js';

const chair = { componentSkuId: 'chair', quantity: 2, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };

const row = (overrides: Partial<BundlePublishRow> = {}): BundlePublishRow => ({
  productId: 'p1',
  productName: 'Furniture set',
  skuId: 'sku-set',
  skuCode: 'SET',
  components: [chair],
  ...overrides,
});

describe('Bundle publish issues', () => {
  it('reports nothing for a product with no virtual SKU or a valid definition', () => {
    expect(findBundlePublishIssues([])).toEqual([]);
    expect(findBundlePublishIssues([row()])).toEqual([]);
    expect(findBundlePublishIssues([row(), row({ skuId: 'sku-set-2', skuCode: 'SET-2' })])).toEqual([]);
  });

  it('reports an active virtual SKU that has no valid definition', () => {
    expect(findBundlePublishIssues([row({ components: [] })])).toEqual([{
      productId: 'p1',
      productName: 'Furniture set',
      skus: [{ skuId: 'sku-set', skuCode: 'SET', reason: expect.any(String) }],
    }]);
  });

  it('reports each unusable definition by its own reason', () => {
    const issues = findBundlePublishIssues([
      row({ components: [{ ...chair, status: 'DISABLED' }] }),
      row({ skuId: 'sku-nested', skuCode: 'NESTED', components: [{ ...chair, isBundle: true }] }),
      row({ skuId: 'sku-quantity', skuCode: 'QUANTITY', components: [{ ...chair, quantity: 0 }] }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].skus.map(sku => sku.skuCode)).toEqual(['SET', 'NESTED', 'QUANTITY']);
    expect(new Set(issues[0].skus.map(sku => sku.reason)).size).toBeGreaterThan(1);
  });

  it('groups several unusable virtual SKUs under their own product', () => {
    const issues = findBundlePublishIssues([
      row({ components: [] }),
      row({ productId: 'p2', productName: 'Desk set', skuId: 'sku-desk', skuCode: 'DESK', components: [{ ...chair, quantity: 2000 }] }),
    ]);
    expect(issues.map(issue => [issue.productId, issue.skus.length])).toEqual([['p1', 1], ['p2', 1]]);
  });
});
