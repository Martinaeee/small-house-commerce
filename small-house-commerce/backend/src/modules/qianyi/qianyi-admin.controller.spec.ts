import { describe, expect, it, vi } from 'vitest';
import { QianyiAdminController } from './qianyi-admin.controller.js';

function skuRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sku-1',
    skuCode: 'TB001-Wa',
    qianyiSkuCode: null,
    packageWeight: 12.5,
    packageWidth: 120,
    packageHeight: 30,
    packageDepth: 60,
    productWeight: 11.2,
    product: { name: 'Console Table', description: null },
    variant: { product: { images: [{ url: 'https://luwag.shop/a.jpg' }] } },
    ...overrides,
  };
}

describe('QianyiAdminController.create', () => {
  it('creates only the ticked, ready, unmapped rows and writes their codes back', async () => {
    const rows: Record<string, ReturnType<typeof skuRow>> = {
      ready: skuRow({ id: 'sku-1' }),
      missing: skuRow({ id: 'sku-2', skuCode: 'SC001', packageWidth: null }),
      mapped: skuRow({ id: 'sku-3', skuCode: 'TB002-oak', qianyiSkuCode: 'ALREADY' }),
    };
    const prisma = {
      sku: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'sku-1' ? rows.ready : where.id === 'sku-2' ? rows.missing : rows.mapped,
        ),
        update: vi.fn(async () => undefined),
      },
    };
    const client = { call: vi.fn(async () => null) };
    const controller = new QianyiAdminController(prisma as never, client as never, {} as never);

    const { results } = await controller.create({ skuIds: ['sku-1', 'sku-2', 'sku-3'] });

    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call).toHaveBeenCalledWith('INSERT_SKU_INFO', 'sku', expect.objectContaining({ sku: 'TB001-Wa' }));
    expect(prisma.sku.update).toHaveBeenCalledTimes(1);
    expect(prisma.sku.update).toHaveBeenCalledWith({
      where: { id: 'sku-1' },
      data: { qianyiSkuCode: 'TB001-Wa' },
    });
    expect(results).toEqual([
      { skuCode: 'TB001-Wa', ok: true },
      { skuCode: 'SC001', ok: false, error: 'missing dimensions or weight' },
    ]);
  });

  it('does not write the mapping when Qianyi rejects the SKU', async () => {
    const prisma = {
      sku: {
        findUnique: vi.fn(async () => skuRow({ id: 'sku-1' })),
        update: vi.fn(async () => undefined),
      },
    };
    const client = {
      call: vi.fn(async () => {
        throw new Error('SKU already exists');
      }),
    };
    const controller = new QianyiAdminController(prisma as never, client as never, {} as never);

    const { results } = await controller.create({ skuIds: ['sku-1'] });

    expect(prisma.sku.update).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ skuCode: 'TB001-Wa', ok: false });
  });
});

describe('QianyiAdminController.map', () => {
  it('stores a trimmed code and clears it when blank', async () => {
    const update = vi.fn(async () => undefined);
    const controller = new QianyiAdminController(
      { sku: { update } } as never,
      {} as never,
      {} as never,
    );

    await controller.map('sku-1', { qianyiSkuCode: '  TB001-Wa  ' });
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'sku-1' },
      data: { qianyiSkuCode: 'TB001-Wa' },
    });

    await controller.map('sku-1', { qianyiSkuCode: '   ' });
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'sku-1' },
      data: { qianyiSkuCode: null },
    });
  });
});
