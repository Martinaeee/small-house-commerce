import { describe, expect, it, vi } from 'vitest';
import { BundlesService } from './bundles.service.js';

const PRODUCT = '00000000-0000-4000-8000-000000000010';
const BUNDLE = '00000000-0000-4000-8000-000000000011';
const COMPONENT = '00000000-0000-4000-8000-000000000012';

function harness(overrides: Record<string, unknown> = {}) {
  const rows: Array<{ bundleSkuId: string; componentSkuId: string; quantity: number; position: number }> = [];
  const bundle = { id: BUNDLE, productId: PRODUCT, isBundle: true, bundleVersion: 0, bundleComponents: [] };
  const component = {
    id: COMPONENT, productId: 'another-product', isBundle: false, status: 'ACTIVE', skuCode: 'CHAIR-BLACK',
    variant: { name: 'Black', product: { name: 'Chair', status: 'ACTIVE' } },
    inventory: [{ onHand: 9, reserved: 1 }], ...overrides,
  };
  const tx = {
    sku: {
      findUnique: vi.fn(async () => ({ ...bundle, bundleComponents: rows.map((row) => ({ ...row, id: 'binding', componentSku: component })) })),
      findMany: vi.fn(async () => [component]),
      updateMany: vi.fn(async ({ where }: { where: { bundleVersion: number } }) => {
        if (where.bundleVersion !== bundle.bundleVersion) return { count: 0 };
        bundle.bundleVersion += 1;
        return { count: 1 };
      }),
    },
    skuBundleComponent: {
      deleteMany: vi.fn(async () => { rows.length = 0; return { count: 1 }; }),
      createMany: vi.fn(async ({ data }: { data: typeof rows }) => { rows.push(...data); return { count: data.length }; }),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
  const service = new BundlesService(prisma as never);
  const input = { expectedVersion: 0, components: [{ componentSkuId: COMPONENT, quantity: 2, position: 0 }] };
  return { service, input, rows, bundle, tx };
}

describe('BundlesService', () => {
  it('searches ordinary component SKU labels with live availability', async () => {
    const { service } = harness();
    expect(await service.search('chair')).toEqual([{ id: COMPONENT, skuCode: 'CHAIR-BLACK', productId: 'another-product', productName: 'Chair', variantName: 'Black', availableInventory: 8 }]);
  });
  it('binds exact SKUs from different products and returns availability', async () => {
    const { service, input, rows } = harness();
    const result = await service.setComponents(PRODUCT, BUNDLE, input);
    expect(rows).toEqual([{ bundleSkuId: BUNDLE, componentSkuId: COMPONENT, quantity: 2, position: 0 }]);
    expect(result).toMatchObject({ version: 1, availableInventory: 4, components: [{ componentSkuCode: 'CHAIR-BLACK', componentProductName: 'Chair', componentVariantName: 'Black' }] });
  });
  it.each([{ isBundle: true }, { status: 'DISABLED' }, { variant: { name: 'Black', product: { name: 'Chair', status: 'DRAFT' } } }])('rejects unavailable or nested components %j', async (change) => {
    const { service, input, rows } = harness(change);
    await expect(service.setComponents(PRODUCT, BUNDLE, input)).rejects.toThrow();
    expect(rows).toEqual([]);
  });
  it('rejects self-reference before writing', async () => {
    const { service, input, rows } = harness();
    input.components[0].componentSkuId = BUNDLE;
    await expect(service.setComponents(PRODUCT, BUNDLE, input)).rejects.toThrow();
    expect(rows).toEqual([]);
  });
  it('rejects a missing component', async () => {
    const { service, input, tx } = harness();
    tx.sku.findMany.mockResolvedValueOnce([]);
    await expect(service.setComponents(PRODUCT, BUNDLE, input)).rejects.toThrow();
  });
  it('rejects stale definitions rather than overwriting a newer edit', async () => {
    const { service, input, rows } = harness();
    await service.setComponents(PRODUCT, BUNDLE, input);
    await expect(service.setComponents(PRODUCT, BUNDLE, { ...input, components: [{ componentSkuId: COMPONENT, quantity: 4, position: 0 }] })).rejects.toThrow();
    expect(rows[0].quantity).toBe(2);
  });
  it('checks the owning product and refuses ordinary SKUs', async () => {
    const { service, input, bundle } = harness();
    await expect(service.setComponents('wrong-product', BUNDLE, input)).rejects.toThrow();
    bundle.isBundle = false;
    await expect(service.setComponents(PRODUCT, BUNDLE, input)).rejects.toThrow();
  });
});
