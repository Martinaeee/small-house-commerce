import { beforeAll, describe, expect, it } from 'vitest';

const enabled = Boolean(process.env.PHASE1_API_ORIGIN);
const productId = '00000000-0000-4000-8000-000000000002';

describe.runIf(enabled)('SKU product dimensions through the real storefront API', () => {
  let origin: string;

  beforeAll(() => {
    const url = new URL(process.env.PHASE1_API_ORIGIN!);
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
    expect(url.protocol).toBe('http:');
    expect(url.port).toBe('3230');
    origin = url.origin;
  });

  it.each([
    ['PDP', '/storefront/products/phase1-table', false],
    ['catalog list', '/storefront/products?pageSize=10', true],
    ['ID lookup', `/storefront/products?ids=${productId}`, true],
  ] as const)('retains raw overrides and nulls in %s without exposing costs', async (_name, path, paged) => {
    const response = await fetch(`${origin}/api/v1${path}`);
    expect(response.status).toBe(200);
    const result = await response.json();
    const product = paged ? result.items.find((item: { id: string }) => item.id === productId) : result;
    expect(product).toMatchObject({ id: productId, name: 'Phase1 table', width: 100, depth: 50, height: 70 });
    const override = product.variants.find((variant: { sku: { skuCode: string } | null }) => variant.sku?.skuCode === 'PHASE1-A');
    const inherited = product.variants.find((variant: { sku: { skuCode: string } | null }) => variant.sku?.skuCode === 'PHASE1-B');
    expect(override.sku).toMatchObject({ productWidth: 120, productDepth: null, productHeight: 75, price: 1499, packageWidth: 130, packageDepth: 70, packageHeight: 85, packageWeight: 5 });
    expect(inherited.sku).toMatchObject({ productWidth: null, productDepth: null, productHeight: null, price: 1599 });
    for (const variant of product.variants) {
      for (const field of ['supplierId', 'supplierSku', 'supplierCost', 'landedCost', 'costCurrency']) {
        expect(Object.hasOwn(variant.sku, field)).toBe(false);
      }
    }
  });
});
