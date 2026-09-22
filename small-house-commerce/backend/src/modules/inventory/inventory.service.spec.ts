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
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const service = new InventoryService(prisma as never);
  return { prisma, tx, rows, service };
}

describe('InventoryService.setOnHandBatch', () => {
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
    const { service, rows, prisma } = createHarness();
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
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
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
    // First entry opens the row (+10); second adjusts the existing row (-3).
    expect(prisma.inventoryMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
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
