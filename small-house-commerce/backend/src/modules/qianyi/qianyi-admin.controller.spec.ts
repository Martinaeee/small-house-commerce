import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { QianyiAdminController } from './qianyi-admin.controller.js';

describe('QianyiAdminController.adopt', () => {
  it('forwards the operator and the Qianyi order number to the service', async () => {
    const adoptExisting = vi.fn(async () => ({ ok: true }));
    const controller = new QianyiAdminController(
      {} as never,
      {} as never,
      { adoptExisting } as never,
    );

    expect(await controller.adopt('job-1', { userId: 'user-1' }, { qianyiOrderNumber: ' QY-1 ' }))
      .toEqual({ ok: true });
    expect(adoptExisting).toHaveBeenCalledWith('job-1', 'user-1', 'QY-1');
  });
});

describe('QianyiAdminController.skus', () => {
  const baseRow = {
    id: 'sku-1',
    skuCode: 'CH001-B',
    qianyiSkuCode: null,
    packageWeight: 1,
    packageWidth: 1,
    packageHeight: 1,
    packageDepth: 1,
    productWeight: 2,
    product: { name: 'Round-Seat Chair', description: null },
    variant: {
      id: 'variant-1',
      name: 'Black',
      optionValues: [{ optionValueId: 'value-black' }],
      product: {
        name: 'Round-Seat Chair',
        description: null,
        images: [
          { url: 'https://cdn.test/shared.jpg', type: 'IMAGE', optionValueId: null, variantId: null, isScene: false },
          { url: 'https://cdn.test/scene.jpg', type: 'IMAGE', optionValueId: null, variantId: null, isScene: true },
          { url: 'https://cdn.test/black.jpg', type: 'IMAGE', optionValueId: 'value-black', variantId: null, isScene: false },
        ],
      },
    },
  };

  it('returns the variant thumbnail and variant name next to the readiness gaps', async () => {
    const findMany = vi.fn(async () => [baseRow]);
    const controller = new QianyiAdminController({ sku: { findMany } } as never, {} as never, {} as never);

    const rows = await controller.skus();

    expect(rows).toEqual([
      {
        id: 'sku-1',
        skuCode: 'CH001-B',
        qianyiSkuCode: null,
        title: 'Round-Seat Chair',
        variantName: 'Black',
        imageUrl: 'https://cdn.test/black.jpg',
        ready: true,
        gaps: [],
      },
    ]);
  });

  it('falls back to a null image when the product has no usable photo', async () => {
    const row = {
      ...baseRow,
      variant: {
        ...baseRow.variant,
        product: { ...baseRow.variant.product, images: [
          { url: 'https://cdn.test/scene.jpg', type: 'IMAGE', optionValueId: null, variantId: null, isScene: true },
        ] },
      },
    };
    const findMany = vi.fn(async () => [row]);
    const controller = new QianyiAdminController({ sku: { findMany } } as never, {} as never, {} as never);

    const [mapped] = await controller.skus();

    expect(mapped.imageUrl).toBeNull();
  });
});

describe('QianyiAdminController.jobs', () => {
  it('selects only the fields the console shows, never the stored payloads', async () => {
    const findMany = vi.fn(async () => []);
    const controller = new QianyiAdminController({ qianyiSyncJob: { findMany } } as never, {} as never, {} as never);

    await controller.jobs();

    const args = findMany.mock.calls[0][0];
    expect(args.select).toBeDefined();
    expect(args.select).not.toHaveProperty('requestPayload');
    expect(args.select).not.toHaveProperty('responsePayload');
    expect(args.select.order).toEqual({ select: { id: true, orderNumber: true } });
  });
  it.each([
    ['todo', { status: { in: ['PENDING', 'SENDING', 'FAILED', 'SKIPPED'] } }],
    ['pending', { status: { in: ['PENDING', 'SENDING'] } }],
    ['failed', { status: 'FAILED' }],
    ['review', { pendingReview: true }],
    ['skipped', { status: 'SKIPPED' }],
    ['all', {}],
  ])('applies the %s filter before the 50-row limit', async (filter, where) => {
    const findMany = vi.fn(async (_args: unknown) => []);
    const controller = new QianyiAdminController({ qianyiSyncJob: { findMany } } as never, {} as never, {} as never);
    await controller.jobs(filter);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, take: 50 }));
  });

  it('filters 24-hour successes by sentAt rather than updatedAt', async () => {
    const findMany = vi.fn(async (_args: unknown) => []);
    const controller = new QianyiAdminController({ qianyiSyncJob: { findMany } } as never, {} as never, {} as never);
    await controller.jobs('sent24h');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'SENT', sentAt: { gte: expect.any(Date) } },
    }));
  });

  it('rejects an unknown job filter', async () => {
    const findMany = vi.fn();
    const controller = new QianyiAdminController({ qianyiSyncJob: { findMany } } as never, {} as never, {} as never);
    await expect(controller.jobs('invalid')).rejects.toThrow(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
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
