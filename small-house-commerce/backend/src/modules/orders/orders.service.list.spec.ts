import { describe, expect, it, vi } from 'vitest';
import { orderQuerySchema } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

/**
 * The admin order list is the drill-down target of the dashboard tiles.
 *
 * Its From/To inputs are Manila calendar days (the day the operator lives in),
 * and it filters by the same payment status the dashboard counts, so a tile
 * can open a list whose length equals the number on the tile.
 */
function harness() {
  const findMany = vi.fn(async (_args: unknown) => []);
  const count = vi.fn(async (_args: unknown) => 0);
  const prisma = {
    order: { findMany, count },
    user: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const where = () => {
    const calls = findMany.mock.calls as unknown as [
      [{ where: Record<string, unknown> }],
    ];
    return calls[0][0].where;
  };
  return { service, where };
}

describe('OrdersService.list date filter', () => {
  it('reads the From/To inputs as Manila calendar days', async () => {
    const { service, where } = harness();

    await service.list(
      orderQuerySchema.parse({ dateFrom: '2026-09-15', dateTo: '2026-09-18' }),
    );

    expect(where().createdAt).toEqual({
      gte: new Date('2026-09-14T16:00:00.000Z'),
      lt: new Date('2026-09-18T16:00:00.000Z'),
    });
  });

  it('opens only the end of the range when no start was given', async () => {
    const { service, where } = harness();

    await service.list(orderQuerySchema.parse({ dateTo: '2026-09-18' }));

    expect(where().createdAt).toEqual({ lt: new Date('2026-09-18T16:00:00.000Z') });
  });
});

describe('OrdersService.list payment status filter', () => {
  it('filters by a single payment status', async () => {
    const { service, where } = harness();

    await service.list(orderQuerySchema.parse({ paymentStatus: 'FAILED' }));

    expect(where().paymentStatus).toBe('FAILED');
  });

  it('accepts a comma-separated set', async () => {
    const { service, where } = harness();

    await service.list(orderQuerySchema.parse({ paymentStatus: 'FAILED,REFUNDED' }));

    expect(where().paymentStatus).toEqual({ in: ['FAILED', 'REFUNDED'] });
  });
});
