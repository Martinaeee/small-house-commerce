import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { replaceItemSchema } from './dto/cart.dto.js';
import { CartService } from './cart.service.js';

// Valid v4 UUIDs (zod 4 enforces version/variant at the DTO boundary).
const CART_ID = '22222222-2222-4222-8222-222222222222';
const CART_ID_B = '22222222-2222-4222-8222-222222222223';
const ITEM_SOURCE = '33333333-3333-4333-8333-333333333331';
const ITEM_TARGET = '33333333-3333-4333-8333-333333333332';
const ITEM_LEGACY = '33333333-3333-4333-8333-333333333333';
const ITEM_OTHER = '33333333-3333-4333-8333-333333333334';
const SKU_SOURCE = '00000000-0000-4000-8000-0000000000a1';
const SKU_TARGET = '00000000-0000-4000-8000-0000000000a2';
const SKU_FOREIGN = '00000000-0000-4000-8000-0000000000a3';
const SKU_LEGACY = '00000000-0000-4000-8000-0000000000a4';
const SKU_OOS = '00000000-0000-4000-8000-0000000000a5';
const SKU_DRIVER_OPTION_OFF = '00000000-0000-4000-8000-0000000000a6';
const SKU_DRIVER_VALUE_OFF = '00000000-0000-4000-8000-0000000000a7';
const SKU_DISABLED = '00000000-0000-4000-8000-0000000000a8';
const SKU_UNKNOWN = '00000000-0000-4000-8000-0000000000a9';
const SKU_DRAFT_PRODUCT = '00000000-0000-4000-8000-0000000000aa';
const SKU_UNPRICED = '00000000-0000-4000-8000-0000000000ab';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000c1';
const PRODUCT_FOREIGN_ID = '00000000-0000-4000-8000-0000000000c2';
const PRODUCT_DRAFT_ID = '00000000-0000-4000-8000-0000000000c3';
const VARIANT_SOURCE = '00000000-0000-4000-8000-0000000000b1';
const VARIANT_TARGET = '00000000-0000-4000-8000-0000000000b2';
const VARIANT_LEGACY = '00000000-0000-4000-8000-0000000000b3';
const VARIANT_OOS = '00000000-0000-4000-8000-0000000000b4';
const VARIANT_FOREIGN = '00000000-0000-4000-8000-0000000000b5';
const VARIANT_DRIVER_OPTION_OFF = '00000000-0000-4000-8000-0000000000b6';
const VARIANT_DRIVER_VALUE_OFF = '00000000-0000-4000-8000-0000000000b7';
const VARIANT_DISABLED = '00000000-0000-4000-8000-0000000000b8';
const VARIANT_DRAFT = '00000000-0000-4000-8000-0000000000b9';
const VARIANT_UNPRICED = '00000000-0000-4000-8000-0000000000ba';
const OPTION_COLOR_ID = '44444444-4444-4444-8444-444444444441';
const OPTION_SIZE_ID = '44444444-4444-4444-8444-444444444442';
const VALUE_BLACK_ID = '55555555-5555-4555-8555-555555555551';
const VALUE_BROWN_ID = '55555555-5555-4555-8555-555555555552';
const VALUE_LARGE_ID = '55555555-5555-4555-8555-555555555553';
const EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z');

interface AssignmentFixture {
  optionId: string;
  optionName: string;
  optionPosition: number;
  optionIsActive: boolean;
  isMediaDriver: boolean;
  optionValueId: string;
  label: string;
  valuePosition: number;
  valueIsActive: boolean;
}

interface SkuFixture {
  productId: string;
  variantId: string;
  variantName: string;
  assignments: AssignmentFixture[];
  status?: string;
  productStatus?: string;
  price?: Prisma.Decimal | null;
}

interface Row {
  id: string;
  cartId: string;
  skuId: string;
  quantity: number;
}

interface ImageFixture {
  id: string;
  productId: string;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  altText: string | null;
  sortOrder: number;
  optionValueId: string | null;
  variantId: string | null;
}

interface InventoryGroup {
  skuId: string;
  _sum: { onHand: number | null; reserved: number | null };
}

const COLOR_OPTION = {
  optionId: OPTION_COLOR_ID,
  optionName: 'Color',
  optionPosition: 0,
  optionIsActive: true,
  isMediaDriver: true,
} as const;

const SIZE_OPTION = {
  optionId: OPTION_SIZE_ID,
  optionName: 'Size',
  optionPosition: 1,
  optionIsActive: true,
  isMediaDriver: false,
} as const;

function assignment(
  option: typeof COLOR_OPTION | typeof SIZE_OPTION,
  optionValueId: string,
  label: string,
  overrides: Partial<AssignmentFixture> = {},
): AssignmentFixture {
  return {
    optionId: option.optionId,
    optionName: option.optionName,
    optionPosition: option.optionPosition,
    optionIsActive: option.optionIsActive,
    isMediaDriver: option.isMediaDriver,
    optionValueId,
    label,
    valuePosition: 0,
    valueIsActive: true,
    ...overrides,
  };
}

const SKU_FIXTURES: Record<string, SkuFixture> = {
  [SKU_SOURCE]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_SOURCE,
    variantName: 'Brown',
    assignments: [assignment(COLOR_OPTION, VALUE_BROWN_ID, 'Brown')],
  },
  [SKU_TARGET]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_TARGET,
    variantName: 'Black / Large',
    // Deliberately out of option-position order to prove the summary sorts.
    assignments: [
      assignment(SIZE_OPTION, VALUE_LARGE_ID, 'Large'),
      assignment(COLOR_OPTION, VALUE_BLACK_ID, 'Black', { valuePosition: 2 }),
    ],
  },
  [SKU_LEGACY]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_LEGACY,
    variantName: 'Brown / Large',
    assignments: [],
  },
  [SKU_OOS]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_OOS,
    variantName: 'Black',
    assignments: [assignment(COLOR_OPTION, VALUE_BLACK_ID, 'Black', { valuePosition: 2 })],
  },
  [SKU_FOREIGN]: {
    productId: PRODUCT_FOREIGN_ID,
    variantId: VARIANT_FOREIGN,
    variantName: 'Desk',
    assignments: [],
  },
  [SKU_DRIVER_OPTION_OFF]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_DRIVER_OPTION_OFF,
    variantName: 'Black',
    assignments: [
      assignment(COLOR_OPTION, VALUE_BLACK_ID, 'Black', {
        optionIsActive: false,
        valuePosition: 2,
      }),
    ],
  },
  [SKU_DRIVER_VALUE_OFF]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_DRIVER_VALUE_OFF,
    variantName: 'Black',
    assignments: [
      assignment(COLOR_OPTION, VALUE_BLACK_ID, 'Black', {
        valueIsActive: false,
        valuePosition: 2,
      }),
    ],
  },
  [SKU_DISABLED]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_DISABLED,
    variantName: 'Disabled',
    assignments: [],
    status: 'DISABLED',
  },
  [SKU_DRAFT_PRODUCT]: {
    productId: PRODUCT_DRAFT_ID,
    variantId: VARIANT_DRAFT,
    variantName: 'Draft',
    assignments: [],
    productStatus: 'DRAFT',
  },
  [SKU_UNPRICED]: {
    productId: PRODUCT_ID,
    variantId: VARIANT_UNPRICED,
    variantName: 'Unpriced',
    assignments: [],
    price: null,
  },
};

const SHARED_IMAGE: ImageFixture = {
  id: 'img-1-shared',
  productId: PRODUCT_ID,
  url: 'https://cdn.example.com/shared.jpg',
  type: 'IMAGE',
  altText: 'Shared view',
  sortOrder: 0,
  optionValueId: null,
  variantId: null,
};

const BLACK_IMAGE: ImageFixture = {
  id: 'img-2-black',
  productId: PRODUCT_ID,
  url: 'https://cdn.example.com/black.jpg',
  type: 'IMAGE',
  altText: 'Black view',
  sortOrder: 1,
  optionValueId: VALUE_BLACK_ID,
  variantId: null,
};

const TARGET_VARIANT_IMAGE: ImageFixture = {
  id: 'img-3-target',
  productId: PRODUCT_ID,
  url: 'https://cdn.example.com/black-large.jpg',
  type: 'IMAGE',
  altText: 'Black large view',
  sortOrder: 2,
  optionValueId: null,
  variantId: VARIANT_TARGET,
};

function row(id: string, skuId: string, quantity: number, cartId = CART_ID): Row {
  return { id, cartId, skuId, quantity };
}

/** The enriched sku shape `buildSummary`'s include produces. */
function skuInclude(skuId: string) {
  const fixture = SKU_FIXTURES[skuId]!;
  return {
    id: skuId,
    skuCode: `SKU-${skuId.slice(-2).toUpperCase()}`,
    price: fixture.price !== undefined ? fixture.price : new Prisma.Decimal('199'),
    compareAtPrice: new Prisma.Decimal('249'),
    variant: {
      id: fixture.variantId,
      name: fixture.variantName,
      product: { id: fixture.productId, name: 'Rattan Chair', slug: 'rattan-chair' },
      optionValues: fixture.assignments.map((a) => ({
        optionId: a.optionId,
        optionValueId: a.optionValueId,
        option: {
          id: a.optionId,
          name: a.optionName,
          position: a.optionPosition,
          isActive: a.optionIsActive,
          isMediaDriver: a.isMediaDriver,
        },
        optionValue: {
          id: a.optionValueId,
          label: a.label,
          position: a.valuePosition,
          isActive: a.valueIsActive,
        },
      })),
    },
  };
}

function createHarness(
  options: { rows?: Row[]; images?: ImageFixture[]; inventory?: InventoryGroup[] } = {},
) {
  const rows = options.rows ?? [row(ITEM_SOURCE, SKU_SOURCE, 1)];
  // DB order: the query orders by (sortOrder asc, id asc); the fake mirrors it.
  const images = [...(options.images ?? [])].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
  let rowCounter = 0;

  const tx = {
    cartItem: {
      findUnique: vi.fn(async ({ where }: { where: { cartId_skuId: { cartId: string; skuId: string } } }) =>
        rows.find(
          (r) => r.cartId === where.cartId_skuId.cartId && r.skuId === where.cartId_skuId.skuId,
        ) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const target = rows.find((r) => r.id === where.id);
        if (!target) throw new Error('Row to update does not exist');
        Object.assign(target, data);
        return { ...target };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex((r) => r.id === where.id);
        if (index < 0) throw new Error('Row to delete does not exist');
        rows.splice(index, 1);
        return {};
      }),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
        rowCounter += 1;
        const created = { id: `row-${rowCounter}`, ...data };
        rows.push(created);
        return created;
      }),
    },
  };

  const prisma = {
    cart: {
      findUnique: vi.fn(async () => ({ id: CART_ID, expiresAt: EXPIRES_AT })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: CART_ID,
        expiresAt: EXPIRES_AT,
        items: rows
          .filter((r) => r.cartId === CART_ID)
          .map((r) => ({ id: r.id, quantity: r.quantity, sku: skuInclude(r.skuId) })),
      })),
      create: vi.fn(async () => ({ id: CART_ID, expiresAt: EXPIRES_AT })),
      delete: vi.fn(async () => ({})),
    },
    cartItem: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const target = rows.find((r) => r.id === where.id);
        if (!target) throw new Error('Row to update does not exist');
        Object.assign(target, data);
        return { ...target };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex((r) => r.id === where.id);
        if (index < 0) throw new Error('Row to delete does not exist');
        rows.splice(index, 1);
        return {};
      }),
    },
    sku: {
      // findPricedSku shape: sku + variant + product status.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const fixture = SKU_FIXTURES[where.id];
        if (!fixture) return null;
        return {
          id: where.id,
          productId: fixture.productId,
          status: fixture.status ?? 'ACTIVE',
          price: fixture.price !== undefined ? fixture.price : new Prisma.Decimal('199'),
          variant: {
            productId: fixture.productId,
            product: { id: fixture.productId, status: fixture.productStatus ?? 'ACTIVE' },
          },
        };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        productId: SKU_FIXTURES[where.id]!.productId,
      })),
    },
    inventory: { groupBy: vi.fn(async () => options.inventory ?? []) },
    productImage: { findMany: vi.fn(async () => images) },
    $transaction: vi.fn(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };

  const service = new CartService(prisma as never);
  return { service, prisma, tx, rows };
}

describe('replaceItemSchema (DTO boundary)', () => {
  it('rejects a non-uuid skuId and out-of-range quantities', () => {
    expect(replaceItemSchema.safeParse({ skuId: 'nope', quantity: 1 }).success).toBe(false);
    expect(replaceItemSchema.safeParse({ skuId: SKU_SOURCE, quantity: 0 }).success).toBe(false);
    expect(replaceItemSchema.safeParse({ skuId: SKU_SOURCE, quantity: 100 }).success).toBe(false);
    expect(replaceItemSchema.safeParse({ skuId: SKU_TARGET, quantity: 2 }).success).toBe(true);
  });
});

describe('CartService.replaceItemSku', () => {
  it('atomically merges when the target SKU already exists', async () => {
    const { service, prisma, tx } = createHarness({
      rows: [row(ITEM_SOURCE, SKU_SOURCE, 1), row(ITEM_TARGET, SKU_TARGET, 1)],
    });

    const cart = await service.replaceItemSku(CART_ID, ITEM_SOURCE, {
      skuId: SKU_TARGET,
      quantity: 2,
    });

    expect(cart.items).toContainEqual(
      expect.objectContaining({ skuId: SKU_TARGET, quantity: 3 }),
    );
    expect(cart.items.some((item) => item.itemId === ITEM_SOURCE)).toBe(false);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM_TARGET }, data: { quantity: 3 } }),
    );
    expect(tx.cartItem.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM_SOURCE } }),
    );
  });

  it('updates the row in place when the target SKU is new to the cart', async () => {
    const { service, tx, rows } = createHarness({ rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)] });

    const cart = await service.replaceItemSku(CART_ID, ITEM_SOURCE, {
      skuId: SKU_TARGET,
      quantity: 2,
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ itemId: ITEM_SOURCE, skuId: SKU_TARGET, quantity: 2 });
    expect(tx.cartItem.delete).not.toHaveBeenCalled();
    expect(tx.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_SOURCE },
        data: { skuId: SKU_TARGET, quantity: 2 },
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it('keeps the row when replacing onto the same SKU', async () => {
    const { service, tx, rows } = createHarness({ rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)] });

    const cart = await service.replaceItemSku(CART_ID, ITEM_SOURCE, {
      skuId: SKU_SOURCE,
      quantity: 4,
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ itemId: ITEM_SOURCE, skuId: SKU_SOURCE, quantity: 4 });
    expect(tx.cartItem.delete).not.toHaveBeenCalled();
    expect(rows).toEqual([row(ITEM_SOURCE, SKU_SOURCE, 4)]);
  });

  it('caps the merged quantity at 99', async () => {
    const { service, rows } = createHarness({
      rows: [row(ITEM_SOURCE, SKU_SOURCE, 1), row(ITEM_TARGET, SKU_TARGET, 97)],
    });

    const cart = await service.replaceItemSku(CART_ID, ITEM_SOURCE, {
      skuId: SKU_TARGET,
      quantity: 5,
    });

    expect(cart.items).toContainEqual(
      expect.objectContaining({ skuId: SKU_TARGET, quantity: 99 }),
    );
    expect(cart.items.some((item) => item.itemId === ITEM_SOURCE)).toBe(false);
    expect(rows).toEqual([row(ITEM_TARGET, SKU_TARGET, 99)]);
  });

  it('rejects an unknown target SKU and leaves the original rows untouched', async () => {
    const { service, prisma, tx, rows } = createHarness({
      rows: [row(ITEM_SOURCE, SKU_SOURCE, 1), row(ITEM_TARGET, SKU_TARGET, 2)],
    });

    await expect(
      service.replaceItemSku(CART_ID, ITEM_SOURCE, { skuId: SKU_UNKNOWN, quantity: 1 }),
    ).rejects.toThrow(BadRequestException);

    expect(rows).toEqual([row(ITEM_SOURCE, SKU_SOURCE, 1), row(ITEM_TARGET, SKU_TARGET, 2)]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.cartItem.delete).not.toHaveBeenCalled();
  });

  it('rejects a disabled target SKU and leaves the original rows untouched', async () => {
    const { service, tx, rows } = createHarness({
      rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)],
    });

    await expect(
      service.replaceItemSku(CART_ID, ITEM_SOURCE, { skuId: SKU_DISABLED, quantity: 1 }),
    ).rejects.toThrow(BadRequestException);

    expect(rows).toEqual([row(ITEM_SOURCE, SKU_SOURCE, 1)]);
    expect(tx.cartItem.update).not.toHaveBeenCalled();
  });

  it('rejects a target whose product is not active and leaves the original rows untouched', async () => {
    const { service, rows } = createHarness({ rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)] });

    await expect(
      service.replaceItemSku(CART_ID, ITEM_SOURCE, { skuId: SKU_DRAFT_PRODUCT, quantity: 1 }),
    ).rejects.toThrow(BadRequestException);

    expect(rows).toEqual([row(ITEM_SOURCE, SKU_SOURCE, 1)]);
  });

  it('rejects an unpriced target SKU and leaves the original rows untouched', async () => {
    const { service, tx, rows } = createHarness({ rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)] });

    await expect(
      service.replaceItemSku(CART_ID, ITEM_SOURCE, { skuId: SKU_UNPRICED, quantity: 1 }),
    ).rejects.toThrow(BadRequestException);

    expect(rows).toEqual([row(ITEM_SOURCE, SKU_SOURCE, 1)]);
    expect(tx.cartItem.update).not.toHaveBeenCalled();
  });

  it('rejects a target SKU from another product and leaves the original rows untouched', async () => {
    const { service, tx, rows } = createHarness({ rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)] });

    await expect(
      service.replaceItemSku(CART_ID, ITEM_SOURCE, { skuId: SKU_FOREIGN, quantity: 1 }),
    ).rejects.toThrow(/different product/);

    expect(rows).toEqual([row(ITEM_SOURCE, SKU_SOURCE, 1)]);
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.cartItem.delete).not.toHaveBeenCalled();
  });

  it('rejects replacing an item that belongs to another cart', async () => {
    const { service, tx, rows } = createHarness({
      rows: [row(ITEM_TARGET, SKU_TARGET, 1, CART_ID_B)],
    });

    await expect(
      service.replaceItemSku(CART_ID, ITEM_TARGET, { skuId: SKU_TARGET, quantity: 1 }),
    ).rejects.toThrow(NotFoundException);

    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.cartItem.delete).not.toHaveBeenCalled();
    expect(rows).toEqual([row(ITEM_TARGET, SKU_TARGET, 1, CART_ID_B)]);
  });

  it('still allows replacing onto an out-of-stock target SKU and flags it', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)],
      inventory: [{ skuId: SKU_TARGET, _sum: { onHand: 2, reserved: 2 } }],
    });

    const cart = await service.replaceItemSku(CART_ID, ITEM_SOURCE, {
      skuId: SKU_TARGET,
      quantity: 2,
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      skuId: SKU_TARGET,
      quantity: 2,
      availableInventory: 0,
      unavailable: true,
    });
  });

  it('returns the enriched summary for the replaced line', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)],
      images: [SHARED_IMAGE, BLACK_IMAGE, TARGET_VARIANT_IMAGE],
    });

    const cart = await service.replaceItemSku(CART_ID, ITEM_SOURCE, {
      skuId: SKU_TARGET,
      quantity: 1,
    });

    expect(cart.items[0]!.optionValues).toEqual([
      { optionId: OPTION_COLOR_ID, optionName: 'Color', optionValueId: VALUE_BLACK_ID, label: 'Black' },
      { optionId: OPTION_SIZE_ID, optionName: 'Size', optionValueId: VALUE_LARGE_ID, label: 'Large' },
    ]);
    expect(cart.items[0]!.thumbnail).toMatchObject({
      url: TARGET_VARIANT_IMAGE.url,
      altText: TARGET_VARIANT_IMAGE.altText,
      resolvedScope: 'VARIANT',
    });
  });
});

describe('CartService.summary enrichment', () => {
  it('exposes typed option values ordered by option position and falls back to the legacy variant name', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_TARGET, SKU_TARGET, 1), row(ITEM_LEGACY, SKU_LEGACY, 1)],
    });

    const cart = await service.summary(CART_ID);

    const target = cart.items.find((item) => item.itemId === ITEM_TARGET)!;
    expect(target.optionValues).toEqual([
      { optionId: OPTION_COLOR_ID, optionName: 'Color', optionValueId: VALUE_BLACK_ID, label: 'Black' },
      { optionId: OPTION_SIZE_ID, optionName: 'Size', optionValueId: VALUE_LARGE_ID, label: 'Large' },
    ]);

    const legacy = cart.items.find((item) => item.itemId === ITEM_LEGACY)!;
    expect(legacy.optionValues).toEqual([]);
    expect(legacy.variantName).toBe('Brown / Large');
  });

  it('prefers the exact variant media for the thumbnail', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_TARGET, SKU_TARGET, 1)],
      images: [SHARED_IMAGE, BLACK_IMAGE, TARGET_VARIANT_IMAGE],
    });

    const cart = await service.summary(CART_ID);

    expect(cart.items[0]!.thumbnail).toMatchObject({
      url: TARGET_VARIANT_IMAGE.url,
      resolvedScope: 'VARIANT',
    });
  });

  it('falls back to the media-driver option value image', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_TARGET, SKU_TARGET, 1)],
      images: [SHARED_IMAGE, BLACK_IMAGE],
    });

    const cart = await service.summary(CART_ID);

    expect(cart.items[0]!.thumbnail).toMatchObject({
      url: BLACK_IMAGE.url,
      altText: BLACK_IMAGE.altText,
      resolvedScope: 'OPTION_VALUE',
    });
  });

  it('falls back to shared product media', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_TARGET, SKU_TARGET, 1)],
      images: [SHARED_IMAGE],
    });

    const cart = await service.summary(CART_ID);

    expect(cart.items[0]!.thumbnail).toMatchObject({
      url: SHARED_IMAGE.url,
      resolvedScope: 'SHARED',
    });
  });

  it('ignores option-value media when the driver option is inactive', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_OTHER, SKU_DRIVER_OPTION_OFF, 1)],
      images: [SHARED_IMAGE, BLACK_IMAGE],
    });

    const cart = await service.summary(CART_ID);

    expect(cart.items[0]!.thumbnail).toMatchObject({
      url: SHARED_IMAGE.url,
      resolvedScope: 'SHARED',
    });
  });

  it('ignores option-value media when the driver value is inactive', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_OTHER, SKU_DRIVER_VALUE_OFF, 1)],
      images: [SHARED_IMAGE, BLACK_IMAGE],
    });

    const cart = await service.summary(CART_ID);

    expect(cart.items[0]!.thumbnail).toMatchObject({
      url: SHARED_IMAGE.url,
      resolvedScope: 'SHARED',
    });
  });

  it('returns a null thumbnail when the product has no media', async () => {
    const { service } = createHarness({ rows: [row(ITEM_TARGET, SKU_TARGET, 1)], images: [] });

    const cart = await service.summary(CART_ID);

    expect(cart.items[0]!.thumbnail).toBeNull();
  });
});

describe('CartService existing regressions', () => {
  it('addItem merges an existing SKU row and caps the result at 99', async () => {
    const { service, tx, rows } = createHarness({ rows: [row(ITEM_TARGET, SKU_TARGET, 97)] });

    const result = await service.addItem({ cartId: CART_ID, skuId: SKU_TARGET, quantity: 5 });

    expect(result.created).toBe(false);
    expect(rows).toEqual([row(ITEM_TARGET, SKU_TARGET, 99)]);
    expect(tx.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM_TARGET }, data: { quantity: 99 } }),
    );
  });

  it('addItem saves an out-of-stock SKU and flags it unavailable', async () => {
    const { service } = createHarness({
      rows: [],
      inventory: [{ skuId: SKU_OOS, _sum: { onHand: 1, reserved: 1 } }],
    });

    const result = await service.addItem({ cartId: CART_ID, skuId: SKU_OOS, quantity: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      skuId: SKU_OOS,
      quantity: 1,
      availableInventory: 0,
      unavailable: true,
    });
  });

  it('updateQuantity replaces the line quantity', async () => {
    const { service, rows } = createHarness({ rows: [row(ITEM_SOURCE, SKU_SOURCE, 1)] });

    const cart = await service.updateQuantity(CART_ID, ITEM_SOURCE, 3);

    expect(cart.items[0]).toMatchObject({ itemId: ITEM_SOURCE, quantity: 3 });
    expect(rows).toEqual([row(ITEM_SOURCE, SKU_SOURCE, 3)]);
  });

  it('removeItem deletes the line', async () => {
    const { service, rows } = createHarness({
      rows: [row(ITEM_SOURCE, SKU_SOURCE, 1), row(ITEM_TARGET, SKU_TARGET, 2)],
    });

    const cart = await service.removeItem(CART_ID, ITEM_SOURCE);

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ itemId: ITEM_TARGET });
    expect(rows).toEqual([row(ITEM_TARGET, SKU_TARGET, 2)]);
  });

  it('summary totals selling prices, keeps compareAtPrice as reference only, and flags short stock', async () => {
    const { service } = createHarness({
      rows: [row(ITEM_TARGET, SKU_TARGET, 2)],
      inventory: [{ skuId: SKU_TARGET, _sum: { onHand: 5, reserved: 1 } }],
    });

    const cart = await service.summary(CART_ID);

    expect(cart.items[0]).toMatchObject({
      skuId: SKU_TARGET,
      quantity: 2,
      unitPrice: 199,
      compareAtPrice: 249,
      lineTotal: 398,
      availableInventory: 4,
      unavailable: false,
    });
    expect(cart.subtotal).toBe(398);
    expect(cart.total).toBe(398);
  });
});
