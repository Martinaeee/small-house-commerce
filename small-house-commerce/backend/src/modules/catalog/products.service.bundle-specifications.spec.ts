import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

function fixture() {
  const component = (id: string, name: string, quantity: number) => ({
    componentSkuId: id, quantity,
    componentSku: {
      status: 'ACTIVE', isBundle: false, productWidth: 45, productDepth: null, productHeight: 0, productWeight: 4,
      supplierCost: 19, supplierSku: 'PRIVATE', inventory: { reserved: 12 },
      variant: { name: 'Oak', product: {
        name, status: 'ACTIVE', width: 40, depth: 50, height: 80,
        foldedWidth: null, foldedDepth: 10, foldedHeight: null, materials: 'Wood', supplierId: 'SECRET',
      } },
    },
  });
  return {
    id: 'set', name: 'Dining Set', slug: 'set', catalogGraphVersion: 0, defaultDisplayVariantId: null,
    width: 999, depth: 999, height: 999, images: [], options: [],
    variants: [{ id: 'set-variant', name: 'Dining Set', position: 0, combinationKey: null, optionValues: [],
      sku: { id: 'set-sku', skuCode: 'SET', status: 'ACTIVE', price: 2499, compareAtPrice: null,
        isBundle: true, productWidth: 999, productDepth: 999, productHeight: 999,
        bundleComponents: [component('table-sku', 'Table', 1), component('chair-sku', 'Chair', 4)],
      },
    }],
  };
}
function harness(row = fixture()) {
  const prisma = {
    product: { findFirst: vi.fn(async () => row), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    inventory: { groupBy: vi.fn(async () => []) },
    sku: { findMany: vi.fn(async () => []) },
    sharedFaqSet: { findUnique: vi.fn(async () => null) },
    productImage: { findMany: vi.fn(async () => []) },
    productOption: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service = new ProductsService(prisma as never, {
    storefrontForProduct: async () => ({}), summaryForProducts: async () => new Map(),
  } as never, {} as never);
  return { service, prisma, row };
}

describe('ProductsService PDP Bundle component specifications', () => {
  it('returns public live component dimensions instead of using the Bundle own dimensions', async () => {
    const { service } = harness();
    const result = await service.storefrontGetBySlug('set');
    expect(result.variants[0].sku).toMatchObject({
      price: 2499, availableInventory: 0, specificationSource: 'BUNDLE_COMPONENTS',
      bundleComponents: [
        { productName: 'Table', variantName: 'Oak', quantity: 1, width: 45, depth: 50, height: 0, foldedDepth: 10, productWeight: 4, materials: 'Wood' },
        { productName: 'Chair', quantity: 4, width: 45, depth: 50, height: 0 },
      ],
    });
    const sku = result.variants[0].sku!;
    expect(sku).not.toHaveProperty('isBundle');
    expect(JSON.stringify(sku)).not.toMatch(/supplier|inventory|reserved|componentSku|productStatus|bundleSnapshot/);
  });

  it('marks ordinary PDP specifications without querying or exposing component projections', async () => {
    const { service, row } = harness();
    row.variants[0].sku.isBundle = false;
    row.variants[0].sku.bundleComponents = [];
    const result = await service.storefrontGetBySlug('set');
    expect(result.variants[0].sku).toMatchObject({ specificationSource: 'SKU', productWidth: 999 });
    expect(result.variants[0].sku).not.toHaveProperty('bundleComponents');
    expect(result.variants[0].sku).not.toHaveProperty('isBundle');
  });

  it.each(['disabled', 'unpublished', 'nested', 'duplicate', 'zero', 'empty'])('fails closed for %s definitions without falling back to parent dimensions', async scenario => {
    const { service, row } = harness();
    const components = row.variants[0].sku.bundleComponents;
    if (scenario === 'disabled') components[1].componentSku.status = 'DISABLED';
    if (scenario === 'unpublished') components[1].componentSku.variant.product.status = 'DRAFT';
    if (scenario === 'nested') components[1].componentSku.isBundle = true;
    if (scenario === 'duplicate') components[1].componentSkuId = components[0].componentSkuId;
    if (scenario === 'zero') components[1].quantity = 0;
    if (scenario === 'empty') components.length = 0;
    const result = await service.storefrontGetBySlug('set');
    expect(result.variants[0].sku).toMatchObject({ specificationSource: 'BUNDLE_COMPONENTS', bundleComponents: [] });
    expect(JSON.stringify(result.variants[0].sku)).not.toMatch(/Chair|PRIVATE|SECRET/);
  });

  it('uses a PDP-only ordered, explicit nested select and leaves list/ID queries lean', async () => {
    const { service, prisma } = harness();
    await service.storefrontGetBySlug('set');
    const first = prisma.product.findFirst.mock.calls[0] as unknown as [{ select: Record<string, unknown> }];
    expect(first[0].select).toHaveProperty('variants.select.sku.select.bundleComponents.orderBy', [{ position: 'asc' }, { id: 'asc' }]);
    const query = JSON.stringify(first[0].select);
    expect(query).not.toMatch(/supplier|landedCost|costCurrency|inventory|bundleSnapshot/);
    await service.storefrontByIds(['set']);
    await service.storefrontList({ page: 1, pageSize: 20 } as never);
    for (const [query] of prisma.product.findMany.mock.calls as unknown as Array<[{ select: unknown }]>) {
      expect(JSON.stringify(query.select)).not.toMatch(/bundleComponents|specificationSource/);
    }
  });

  it('projects each new read without changing a historical order snapshot', async () => {
    const { service, row } = harness();
    const history = { unitPrice: 2499, total: 2499, bundleSnapshot: structuredClone(row.variants[0].sku.bundleComponents) };
    const before = structuredClone(history);
    await service.storefrontGetBySlug('set');
    row.variants[0].sku.bundleComponents[1].componentSku.productWidth = 47;
    const result = await service.storefrontGetBySlug('set');
    expect(result.variants[0].sku).toHaveProperty('bundleComponents.1.width', 47);
    expect(history).toEqual(before);
  });
});
