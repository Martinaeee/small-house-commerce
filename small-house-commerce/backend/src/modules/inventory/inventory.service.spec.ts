import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from './inventory.service.js';
import { inventoryBatchSetStockSchema } from './dto/inventory.dto.js';

const WH_ID = '00000000-0000-4000-8000-0000000000ff';

interface InvRow {
  id: string;
  skuId: string;
  onHand: number;
  reserved: number;
}

/**
 * Hand-rolled Prisma mock in the style of orders.service.spec.ts: the real
 * service code runs (including its $transaction callbacks), only the database
 * is faked. The inventory row map mirrors the default warehouse's rows.
 */
function createHarness() {
  const rows = new Map<string, InvRow>();
  const events: string[] = [];
  const backInStock = {
    snapshotForChangedSkusWithin: vi.fn(
      async (_tx: unknown, skuIds: readonly string[]) =>
        new Map(
          skuIds.map((skuId) => {
            const row = rows.get(skuId);
            return [skuId, row ? row.onHand - row.reserved : 0] as const;
          }),
        ),
    ),
    claimTransitionsWithin: vi.fn(
      async (
        _tx: unknown,
        before: ReadonlyMap<string, number>,
        after: ReadonlyMap<string, number>,
      ) =>
        [...before].some(
          ([skuId, available]) =>
            available <= 0 && (after.get(skuId) ?? available) > 0,
        )
          ? [{ id: 'claim-1' }]
          : [],
    ),
    deliverClaims: vi.fn(async () => {
      events.push('delivery');
    }),
  };
  const tx = {
    inventory: {
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: { onHand?: { increment: number } };
        }) => {
          const row = [...rows.values()].find((r) => r.id === args.where.id);
          if (!row) throw new Error('inventory row not found');
          if (args.data.onHand?.increment !== undefined) {
            row.onHand += args.data.onHand.increment;
          }
          return row;
        },
      ),
    },
    inventoryMovement: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    sku: { findUnique: vi.fn(async (): Promise<{ isBundle: boolean }> => ({ isBundle: false })), findMany: vi.fn(async (): Promise<unknown[]> => []) },
    warehouse: {
      findFirst: vi.fn(async () => ({ id: WH_ID, status: 'ACTIVE' })),
    },
    inventory: {
      findUnique: vi.fn(
        async (args: { where: { skuId_warehouseId: { skuId: string } } }) =>
          rows.get(args.where.skuId_warehouseId.skuId) ?? null,
      ),
      create: vi.fn(
        async (args: { data: { skuId: string; onHand: number } }) => {
          const row: InvRow = {
            id: `inv-${rows.size + 1}`,
            skuId: args.data.skuId,
            onHand: args.data.onHand,
            reserved: 0,
          };
          rows.set(args.data.skuId, row);
          return row;
        },
      ),
      findUniqueOrThrow: vi.fn(
        async (args: {
          where: {
            id?: string;
            skuId_warehouseId?: { skuId: string };
          };
        }) => {
          const row = args.where.id
            ? [...rows.values()].find((r) => r.id === args.where.id)
            : rows.get(args.where.skuId_warehouseId!.skuId);
          if (!row) throw new Error('missing inventory row');
          return row;
        },
      ),
    },
    inventoryMovement: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
      events.push('transaction:start');
      const result = await cb(tx);
      events.push('transaction:commit');
      return result;
    }),
  };
  const txInventoryCreate = vi.fn(
    async (args: { data: { skuId: string; onHand: number } }) => {
      const row: InvRow = {
        id: `tx-inv-${rows.size + 1}`,
        skuId: args.data.skuId,
        onHand: args.data.onHand,
        reserved: 0,
      };
      rows.set(args.data.skuId, row);
      return row;
    },
  );
  Object.assign(tx.inventory, {
    findUnique: vi.fn(
      async (args: { where: { skuId_warehouseId: { skuId: string } } }) =>
        rows.get(args.where.skuId_warehouseId.skuId) ?? null,
    ),
    findUniqueOrThrow: vi.fn(
      async (args: {
        where: { id?: string; skuId_warehouseId?: { skuId: string } };
      }) => {
        const row = args.where.id
          ? [...rows.values()].find((item) => item.id === args.where.id)
          : rows.get(args.where.skuId_warehouseId!.skuId);
        if (!row) throw new Error('missing inventory row');
        return row;
      },
    ),
    create: txInventoryCreate,
  });
  Object.assign(tx, { $queryRaw: vi.fn(async () => []) });
  const service = new InventoryService(prisma as never, backInStock as never);
  return {
    prisma,
    tx,
    txInventoryCreate,
    rows,
    service,
    backInStock,
    events,
  };
}

describe('InventoryService.setOnHandBatch', () => {
  it('refuses manual and absolute stock for a virtual Bundle', async () => {
    const { service, prisma, rows } = createHarness();
    prisma.sku.findUnique.mockResolvedValue({ isBundle: true });
    await expect(service.setOnHand('bundle', 0, undefined, undefined)).rejects.toThrow(/Bundle/);
    await expect(service.adjust('bundle', 5, undefined, undefined)).rejects.toThrow(/Bundle/);
    expect(rows.size).toBe(0);
  });
  it('returns derived availability without on-hand stock for a Bundle', async () => {
    const { service, prisma } = createHarness();
    Object.assign(prisma.inventory, { groupBy: vi.fn(async () => []) });
    prisma.sku.findMany.mockResolvedValue([{ id: 'bundle', status: 'ACTIVE', bundleComponents: [{ quantity: 2, componentSku: {
      isBundle: false, status: 'ACTIVE', variant: { product: { status: 'ACTIVE' } }, inventory: [{ onHand: 9, reserved: 1 }],
    } }] }]);
    expect(await service.stockBySku(['bundle'])).toEqual(new Map([['bundle', { onHand: 0, reserved: 0, available: 4 }]]));
  });
  it('claims a zero-to-positive adjustment in the stock transaction and delivers after commit', async () => {
    const { service, rows, backInStock, events } = createHarness();
    rows.set('restocked', {
      id: 'inv-restocked',
      skuId: 'restocked',
      onHand: 0,
      reserved: 0,
    });
    backInStock.deliverClaims.mockImplementationOnce(async () => {
      expect(events.at(-1)).toBe('transaction:commit');
      events.push('delivery');
    });

    await expect(
      service.adjust('restocked', 2, 'restock', 'op-1'),
    ).resolves.toMatchObject({ onHand: 2, available: 2 });

    expect(backInStock.snapshotForChangedSkusWithin).toHaveBeenCalledTimes(2);
    expect(backInStock.claimTransitionsWithin).toHaveBeenCalledTimes(1);
    expect(backInStock.deliverClaims).toHaveBeenCalledWith([
      { id: 'claim-1' },
    ]);
    expect(events).toEqual([
      'transaction:start',
      'transaction:commit',
      'delivery',
    ]);
  });

  it('creates first stock and its movement in the same transaction before delivery', async () => {
    const {
      service,
      prisma,
      tx,
      txInventoryCreate,
      backInStock,
      events,
    } = createHarness();

    await expect(
      service.setOnHand('new-sku', 3, 'initial stock', 'op-1'),
    ).resolves.toMatchObject({ onHand: 3, available: 3 });

    expect(prisma.inventory.create).not.toHaveBeenCalled();
    expect(txInventoryCreate).toHaveBeenCalled();
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skuId: 'new-sku',
        quantity: 3,
        movementType: 'MANUAL_ADJUSTMENT',
      }),
    });
    expect(backInStock.deliverClaims).toHaveBeenCalledTimes(1);
    expect(events.indexOf('transaction:commit')).toBeLessThan(
      events.indexOf('delivery'),
    );
  });

  it('does not deliver for a positive-to-positive adjustment', async () => {
    const { service, rows, backInStock } = createHarness();
    rows.set('available', {
      id: 'inv-available',
      skuId: 'available',
      onHand: 3,
      reserved: 0,
    });

    await service.adjust('available', 2, undefined, undefined);

    expect(backInStock.claimTransitionsWithin).toHaveBeenCalledTimes(1);
    expect(backInStock.deliverClaims).not.toHaveBeenCalled();
  });

  it('settles a single entry in one chunk', async () => {
    const { service } = createHarness();
    const chunkSpy = vi.spyOn(service, 'settleChunk');

    const result = await service.setOnHandBatch([{ skuId: 'only', onHand: 3 }], 'op-1');

    expect(chunkSpy).toHaveBeenCalledTimes(1);
    expect(chunkSpy.mock.calls[0]![0]).toHaveLength(1);
    expect(result).toEqual([
      { skuId: 'only', ok: true, onHand: 3, reserved: 0, available: 3 },
    ]);
  });

  it('processes 100 entries as ten chunks of ten in input order', async () => {
    const { service } = createHarness();
    const chunkSpy = vi.spyOn(service, 'settleChunk');
    const entries = Array.from({ length: 100 }, (_, i) => ({
      skuId: `sku-${i}`,
      onHand: i + 1,
    }));

    const result = await service.setOnHandBatch(entries, 'op-1');

    expect(chunkSpy).toHaveBeenCalledTimes(10);
    expect(chunkSpy.mock.calls.every((call) => call[0].length === 10)).toBe(true);
    expect(chunkSpy.mock.calls[0]![0][0]).toMatchObject({ skuId: 'sku-0' });
    expect(chunkSpy.mock.calls[9]![0][9]).toMatchObject({ skuId: 'sku-99' });
    expect(result).toHaveLength(100);
    expect(result.every((r) => r.ok)).toBe(true);
    expect(result[0]).toMatchObject({ skuId: 'sku-0', onHand: 1 });
    expect(result[99]).toMatchObject({ skuId: 'sku-99', onHand: 100 });
  });

  it('keeps successful ledger writes when another SKU fails', async () => {
    const { service, rows, tx } = createHarness();
    rows.set('reserved', {
      id: 'inv-reserved',
      skuId: 'reserved',
      onHand: 5,
      reserved: 5,
    });

    const result = await service.setOnHandBatch(
      [
        { skuId: 'ok', onHand: 10 },
        { skuId: 'reserved', onHand: 1 },
      ],
      'op-1',
    );

    expect(result).toEqual([
      expect.objectContaining({ skuId: 'ok', ok: true }),
      expect.objectContaining({ skuId: 'reserved', ok: false }),
    ]);
    // The failure must not roll back the successful SKU's ledger write.
    expect(rows.get('ok')?.onHand).toBe(10);
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: 'MANUAL_ADJUSTMENT',
          quantity: 10,
          warehouseId: WH_ID,
        }),
      }),
    );
    // ...and the failed SKU wrote nothing.
    expect(rows.get('reserved')).toMatchObject({ onHand: 5, reserved: 5 });
  });

  it('reports a safe error message for a failed SKU', async () => {
    const { service, rows } = createHarness();
    rows.set('reserved', {
      id: 'inv-reserved',
      skuId: 'reserved',
      onHand: 5,
      reserved: 5,
    });

    const result = await service.setOnHandBatch(
      [{ skuId: 'reserved', onHand: 1 }],
      'op-1',
    );

    expect(result[0]).toMatchObject({ skuId: 'reserved', ok: false });
    if (result[0]!.ok) throw new Error('expected failure');
    expect(result[0].error).toMatch(/reserved by open orders/i);
  });

  it('applies duplicate SKU ids in input order (last write wins)', async () => {
    const { service, prisma, tx } = createHarness();

    const result = await service.setOnHandBatch(
      [
        { skuId: 'dup', onHand: 10 },
        { skuId: 'dup', onHand: 7 },
      ],
      'op-1',
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ skuId: 'dup', ok: true, onHand: 10 });
    expect(result[1]).toMatchObject({ skuId: 'dup', ok: true, onHand: 7 });
    // Both writes use their own transaction; the first creates and the second adjusts.
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(2);
    expect(tx.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { onHand: { increment: -3 } } }),
    );
  });

  it('writes a MANUAL_ADJUSTMENT movement when changing an existing row', async () => {
    const { service, rows, tx } = createHarness();
    rows.set('existing', {
      id: 'inv-existing',
      skuId: 'existing',
      onHand: 4,
      reserved: 0,
    });

    const result = await service.setOnHandBatch(
      [{ skuId: 'existing', onHand: 9, reason: 'stock count' }],
      'op-1',
    );

    expect(result[0]).toMatchObject({ ok: true, onHand: 9 });
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: {
        skuId: 'existing',
        warehouseId: WH_ID,
        movementType: 'MANUAL_ADJUSTMENT',
        quantity: 5,
        operatorId: 'op-1',
        reason: 'stock count',
      },
    });
  });

  it('retries failed rows without touching already settled SKUs', async () => {
    const { service, rows, prisma, tx } = createHarness();
    rows.set('reserved', {
      id: 'inv-reserved',
      skuId: 'reserved',
      onHand: 5,
      reserved: 5,
    });

    const first = await service.setOnHandBatch(
      [
        { skuId: 'ok', onHand: 10 },
        { skuId: 'reserved', onHand: 1 },
      ],
      'op-1',
    );
    expect(first.map((r) => r.ok)).toEqual([true, false]);

    // Client refetches, then resubmits ONLY the failed row.
    const setSpy = vi.spyOn(service, 'setOnHand');
    prisma.inventoryMovement.create.mockClear();
    tx.inventoryMovement.create.mockClear();

    const retry = await service.setOnHandBatch(
      [{ skuId: 'reserved', onHand: 7 }],
      'op-1',
    );

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![0]).toBe('reserved');
    expect(retry[0]).toMatchObject({
      skuId: 'reserved',
      ok: true,
      onHand: 7,
      reserved: 5,
      available: 2,
    });
    // The already-settled SKU gets no second movement; the retry writes one.
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
  });

  it('processes entries strictly sequentially (never two writes in flight)', async () => {
    const { service } = createHarness();
    const inFlight = new Set<string>();
    let maxInFlight = 0;
    vi.spyOn(service, 'setOnHand').mockImplementation(
      async (skuId: string, onHand: number) => {
        inFlight.add(skuId);
        maxInFlight = Math.max(maxInFlight, inFlight.size);
        await Promise.resolve();
        await Promise.resolve();
        inFlight.delete(skuId);
        return { onHand, reserved: 0, available: onHand };
      },
    );

    await service.setOnHandBatch(
      Array.from({ length: 25 }, (_, i) => ({ skuId: `s${i}`, onHand: i })),
      'op-1',
    );

    expect(maxInFlight).toBe(1);
  });
});

describe('inventoryBatchSetStockSchema', () => {
  function batchUuid(i: number) {
    const hex = i.toString(16);
    const p = (n: number) => hex.padStart(n, '0');
    return `${p(8)}-${p(4)}-4${p(3)}-8${p(3)}-${p(12)}`;
  }

  const entry = (i: number) => ({ skuId: batchUuid(i), onHand: 1 });

  it('accepts 1 and 100 entries', () => {
    expect(inventoryBatchSetStockSchema.safeParse([entry(0)]).success).toBe(true);
    expect(
      inventoryBatchSetStockSchema.safeParse(
        Array.from({ length: 100 }, (_, i) => entry(i)),
      ).success,
    ).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(inventoryBatchSetStockSchema.safeParse([]).success).toBe(false);
  });

  it('rejects 101 entries (bounded)', () => {
    const result = inventoryBatchSetStockSchema.safeParse(
      Array.from({ length: 101 }, (_, i) => entry(i)),
    );
    expect(result.success).toBe(false);
  });

  it('validates each entry with the set-stock shape', () => {
    expect(
      inventoryBatchSetStockSchema.safeParse([{ skuId: 'not-a-uuid', onHand: 1 }])
        .success,
    ).toBe(false);
    expect(
      inventoryBatchSetStockSchema.safeParse([
        { skuId: batchUuid(1), onHand: -1 },
      ]).success,
    ).toBe(false);
    expect(
      inventoryBatchSetStockSchema.safeParse([
        { skuId: batchUuid(1), onHand: 1, reason: 'x'.repeat(256) },
      ]).success,
    ).toBe(false);
  });
});
