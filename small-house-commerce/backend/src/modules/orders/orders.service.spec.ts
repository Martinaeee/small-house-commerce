import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../inventory/inventory.service.js';
import { checkoutSchema } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

// Valid v4 UUIDs: zod 4 enforces version/variant, and skuId/landingPageId pass
// through z.string().uuid() at the DTO boundary.
const SKU_ID = '00000000-0000-4000-8000-0000000000a1';
const LP_ID = '11111111-1111-4111-a111-111111111111';

function skuRecord() {
  return {
    id: SKU_ID,
    skuCode: 'CHAIR-1',
    status: 'ACTIVE',
    price: new Prisma.Decimal('199'),
    landedCost: new Prisma.Decimal('100'),
    variant: {
      id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Single',
      productId: '00000000-0000-4000-8000-0000000000c1',
      product: {
        id: '00000000-0000-4000-8000-0000000000c1',
        name: 'Chair',
        status: 'ACTIVE',
      },
    },
  };
}

function checkoutOverrides(overrides: Record<string, unknown> = {}) {
  return checkoutSchema.parse({
    customer: {
      name: 'Jane',
      phone: '09171234567',
      province: 'Metro Manila',
      city: 'Manila',
      streetAddress: '1 Main St',
    },
    items: [{ skuId: SKU_ID, quantity: 1 }],
    ...overrides,
  });
}

function createHarness() {
  const tx = {
    order: {
      create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'order-1' })),
    },
    orderStatusHistory: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    customer: { upsert: vi.fn(async () => ({ id: 'cust-1' })) },
    sku: { findUnique: vi.fn(async () => skuRecord()) },
    $queryRaw: vi.fn(async () => [{ nextval: 1n }]),
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const inventory = {
    availableBySku: vi.fn(async () => new Map([[SKU_ID, 5]])),
    defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })),
    reserveWithin: vi.fn(async () => ({})),
  };
  const service = new OrdersService(prisma as never, inventory as unknown as InventoryService);
  return { service, prisma, tx, inventory };
}

describe('OrdersService.checkout attribution', () => {
  it('persists landingPageId into OrderAttribution when provided', async () => {
    const { service, tx } = createHarness();
    await service.checkout(checkoutOverrides({ attribution: { landingPageId: LP_ID } }));
    const data = tx.order.create.mock.calls[0]![0].data as {
      attribution: { create: Record<string, unknown> };
    };
    expect(data.attribution.create.landingPageId).toBe(LP_ID);
  });

  it('persists null landingPageId when attribution omits it', async () => {
    const { service, tx } = createHarness();
    // attribution itself is required (sourceType defaults to ORGANIC);
    // only landingPageId is absent here.
    await service.checkout(checkoutOverrides({ attribution: {} }));
    const data = tx.order.create.mock.calls[0]![0].data as {
      attribution: { create: Record<string, unknown> };
    };
    expect(data.attribution.create.landingPageId).toBeNull();
  });

  it('rejects a non-uuid landingPageId at the DTO boundary', () => {
    // safeParse the raw object: parse() output would already be validated.
    const result = checkoutSchema.safeParse({
      customer: {
        name: 'Jane',
        phone: '09171234567',
        province: 'Metro Manila',
        city: 'Manila',
        streetAddress: '1 Main St',
      },
      items: [{ skuId: SKU_ID, quantity: 1 }],
      attribution: { landingPageId: 'not-a-uuid' },
    });
    expect(result.success).toBe(false);
  });
});
