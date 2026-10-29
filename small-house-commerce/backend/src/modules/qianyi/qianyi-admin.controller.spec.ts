import { describe, expect, it, vi } from 'vitest';
import { QianyiAdminController } from './qianyi-admin.controller.js';

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

  it('verifies the code against the Qianyi catalog before saving it', async () => {
    const update = vi.fn(async () => undefined);
    const call = vi.fn(async () => ({ result: [{ sku: 'TB001-Wa', purchaseCost: '3.20' }] }));
    const controller = new QianyiAdminController(
      { sku: { update } } as never,
      { enabled: true, shop: 'LUWAG- PH', call } as never,
      {} as never,
    );

    await controller.map('sku-1', { qianyiSkuCode: ' TB001-Wa ' });

    expect(call).toHaveBeenCalledWith('QUERY_SIMPLE_LIST_SKU', 'sku', {
      shop: 'LUWAG- PH',
      page: 1,
      pageSize: 5,
      skus: ['TB001-Wa'],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sku-1' },
      data: { qianyiSkuCode: 'TB001-Wa' },
    });
  });

  it('refuses a code the catalog does not contain', async () => {
    const update = vi.fn(async () => undefined);
    const controller = new QianyiAdminController(
      { sku: { update } } as never,
      { enabled: true, shop: 'LUWAG- PH', call: vi.fn(async () => ({ result: [] })) } as never,
      {} as never,
    );

    await expect(controller.map('sku-1', { qianyiSkuCode: 'NOPE' })).rejects.toThrow(/not found/i);
    expect(update).not.toHaveBeenCalled();
  });
});
