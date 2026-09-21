import { readFile } from 'node:fs/promises';
import { Prisma } from '../src/generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import {
  analyzeBackfillMigrationSql,
  catalogSnapshotFingerprint,
  compareCatalogSnapshots,
  legacyStyleOptionId,
  legacyStyleValueId,
  parseAuditArgs,
  stableSerialize,
  validateCatalogSnapshot,
  type CatalogAuditSnapshot,
} from './catalog-graph-audit.js';

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const FIRST_VARIANT_ID = '22222222-2222-2222-2222-222222222222';
const SECOND_VARIANT_ID = '33333333-3333-3333-3333-333333333333';
const FIRST_SKU_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const SECOND_SKU_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const OPTION_ID = '0c2d1cb8-069c-c4e0-a33d-548be39e0f9e';
const FIRST_VALUE_ID = '4cc42cf1-05f4-81d1-9f03-2aaa78691a1a';
const SECOND_VALUE_ID = 'b9670246-7918-0f70-fc51-066b33c81423';

const before: CatalogAuditSnapshot = {
  formatVersion: 1,
  products: [
    {
      id: PRODUCT_ID,
      name: 'Legacy chair',
      slug: 'legacy-chair',
      description: 'Legacy description',
      tagline: 'Small-space comfort',
      categoryId: 'category-1',
      status: 'ACTIVE',
      room: 'DINING_LIVING',
      internalRole: 'CORE',
      solutions: ['NARROW_SPACE'],
      width: 80,
      height: 90,
      depth: 70,
      foldedWidth: null,
      foldedHeight: null,
      foldedDepth: null,
      materials: 'Oak',
      features: 'Foldable',
      catalogGraphVersion: 0,
      defaultDisplayVariantId: null,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    },
  ],
  variants: [
    {
      id: FIRST_VARIANT_ID,
      productId: PRODUCT_ID,
      name: 'Priced sold-out style',
      position: 1,
      combinationKey: null,
    },
    {
      id: SECOND_VARIANT_ID,
      productId: PRODUCT_ID,
      name: 'Unpriced style',
      position: 0,
      combinationKey: null,
    },
  ],
  skus: [
    {
      id: FIRST_SKU_ID,
      productId: PRODUCT_ID,
      variantId: FIRST_VARIANT_ID,
      skuCode: 'PRICED',
      status: 'ACTIVE',
      price: '899.00',
      compareAtPrice: '999.00',
    },
    {
      id: SECOND_SKU_ID,
      productId: PRODUCT_ID,
      variantId: SECOND_VARIANT_ID,
      skuCode: 'UNPRICED',
      status: 'ACTIVE',
      price: null,
      compareAtPrice: null,
    },
  ],
  inventory: [
    {
      id: 'inventory-1',
      skuId: FIRST_SKU_ID,
      warehouseId: 'warehouse-1',
      onHand: 0,
      reserved: 0,
      updatedAt: '2026-09-21T00:00:00.000Z',
    },
  ],
  reservations: [
    {
      id: 'reservation-1',
      orderId: 'order-1',
      skuId: FIRST_SKU_ID,
      warehouseId: 'warehouse-1',
      quantity: 1,
      status: 'ACTIVE',
      createdAt: '2026-09-21T00:01:00.000Z',
    },
  ],
  movements: [
    {
      id: 'movement-1',
      skuId: FIRST_SKU_ID,
      warehouseId: 'warehouse-1',
      movementType: 'ORDER_RESERVED',
      quantity: 1,
      referenceType: 'ORDER',
      referenceId: 'order-1',
      operatorId: null,
      reason: null,
      createdAt: '2026-09-21T00:02:00.000Z',
    },
  ],
  carts: [
    {
      id: 'cart-1',
      expiresAt: '2026-10-21T00:00:00.000Z',
      createdAt: '2026-09-21T00:03:00.000Z',
      updatedAt: '2026-09-21T00:03:00.000Z',
    },
    {
      id: 'empty-cart',
      expiresAt: '2026-10-22T00:00:00.000Z',
      createdAt: '2026-09-21T00:03:00.000Z',
      updatedAt: '2026-09-21T00:03:00.000Z',
    },
  ],
  cartItems: [
    {
      id: 'cart-item-1',
      cartId: 'cart-1',
      skuId: FIRST_SKU_ID,
      quantity: 1,
      createdAt: '2026-09-21T00:03:00.000Z',
    },
  ],
  orders: [
    {
      id: 'order-1',
      orderNumber: 'LUWAG-1',
      subtotal: '899.00',
      grandTotal: '899.00',
      createdAt: '2026-09-21T00:04:00.000Z',
    },
  ],
  orderItems: [
    {
      id: 'order-item-1',
      orderId: 'order-1',
      productId: PRODUCT_ID,
      variantId: FIRST_VARIANT_ID,
      skuId: FIRST_SKU_ID,
      productNameSnapshot: 'Legacy chair',
      skuCodeSnapshot: 'PRICED',
      variantSnapshot: 'Priced sold-out style',
      optionSnapshot: null,
      quantity: 1,
      unitPrice: '899.00',
      lineTotal: '899.00',
      createdAt: '2026-09-21T00:04:00.000Z',
    },
  ],
  media: [
    {
      id: 'image-1',
      productId: PRODUCT_ID,
      optionValueId: null,
      variantId: null,
      url: '/legacy.jpg',
      type: 'IMAGE',
      altText: 'Legacy chair',
      sortOrder: 0,
      createdAt: '2026-09-21T00:05:00.000Z',
    },
  ],
  options: [],
  optionValues: [],
  assignments: [],
};

const after: CatalogAuditSnapshot = {
  ...structuredClone(before),
  products: [
    {
      ...before.products[0]!,
      catalogGraphVersion: 1,
      defaultDisplayVariantId: FIRST_VARIANT_ID,
    },
  ],
  variants: [
    {
      ...before.variants[0]!,
      combinationKey: `${OPTION_ID}:${FIRST_VALUE_ID}`,
    },
    {
      ...before.variants[1]!,
      combinationKey: `${OPTION_ID}:${SECOND_VALUE_ID}`,
    },
  ],
  options: [
    {
      id: OPTION_ID,
      productId: PRODUCT_ID,
      kind: 'STYLE',
      name: 'Style',
      position: 0,
      presentation: 'TEXT',
      isMediaDriver: false,
      isActive: true,
    },
  ],
  optionValues: [
    {
      id: FIRST_VALUE_ID,
      productId: PRODUCT_ID,
      optionId: OPTION_ID,
      label: 'Priced sold-out style',
      position: 1,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
      isActive: true,
    },
    {
      id: SECOND_VALUE_ID,
      productId: PRODUCT_ID,
      optionId: OPTION_ID,
      label: 'Unpriced style',
      position: 0,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
      isActive: true,
    },
  ],
  assignments: [
    {
      variantId: FIRST_VARIANT_ID,
      productId: PRODUCT_ID,
      optionId: OPTION_ID,
      optionValueId: FIRST_VALUE_ID,
    },
    {
      variantId: SECOND_VARIANT_ID,
      productId: PRODUCT_ID,
      optionId: OPTION_ID,
      optionValueId: SECOND_VALUE_ID,
    },
  ],
};

function changed(
  mutate: (snapshot: CatalogAuditSnapshot) => void,
  source: CatalogAuditSnapshot = after,
): CatalogAuditSnapshot {
  const snapshot = structuredClone(source);
  mutate(snapshot);
  return snapshot;
}

function violationCodes(
  baseline: CatalogAuditSnapshot,
  candidate: CatalogAuditSnapshot,
): string[] {
  return compareCatalogSnapshots(baseline, candidate).map(
    (violation) => violation.code,
  );
}

describe('catalog graph audit', () => {
  it('matches Task 3 literal deterministic option and value IDs', () => {
    expect(legacyStyleOptionId(PRODUCT_ID)).toBe(OPTION_ID);
    expect(legacyStyleValueId(FIRST_VARIANT_ID)).toBe(FIRST_VALUE_ID);
    expect(legacyStyleValueId(SECOND_VARIANT_ID)).toBe(SECOND_VALUE_ID);
  });

  it('accepts the deterministic legacy backfill and stock-zero default', () => {
    expect(compareCatalogSnapshots(before, after)).toEqual([]);
    expect(after.products[0]?.defaultDisplayVariantId).toBe(FIRST_VARIANT_ID);
  });

  it('accepts an idempotent deterministic second run with no drift', () => {
    const afterSecondRun = structuredClone(after);

    expect(compareCatalogSnapshots(after, afterSecondRun)).toEqual([]);
    expect(catalogSnapshotFingerprint(afterSecondRun)).toBe(
      catalogSnapshotFingerprint(after),
    );
  });

  it.each([
    ['name', 'Rewritten chair'],
    ['slug', 'rewritten-chair'],
    ['description', 'Rewritten description'],
    ['tagline', 'Rewritten tagline'],
    ['categoryId', 'category-2'],
    ['status', 'DISABLED'],
    ['room', 'BEDROOM'],
    ['internalRole', 'PREMIUM'],
    ['solutions', ['FOLDABLE']],
    ['width', 81],
    ['height', 91],
    ['depth', 71],
    ['foldedWidth', 40],
    ['foldedHeight', 45],
    ['foldedDepth', 35],
    ['materials', 'Steel'],
    ['features', 'Rewritten features'],
    ['createdAt', '2026-09-19T00:00:00.000Z'],
    ['updatedAt', '2026-09-22T00:00:00.000Z'],
  ] as const)('detects changed non-graph product field %s', (field, value) => {
    const changedProduct = changed((snapshot) => {
      snapshot.products[0]![field] = value;
    });

    expect(violationCodes(before, changedProduct)).toContain(
      'PRODUCT_DATA_CHANGED',
    );
  });

  it('detects a deleted empty cart by identity', () => {
    const changedCarts = changed((snapshot) => {
      snapshot.carts = snapshot.carts.filter(
        (cart) => cart.id !== 'empty-cart',
      );
    });

    expect(violationCodes(before, changedCarts)).toEqual(
      expect.arrayContaining(['CART_ID_SET_CHANGED', 'CART_DATA_CHANGED']),
    );
  });

  it.each([
    ['expiresAt', '2026-11-21T00:00:00.000Z'],
    ['createdAt', '2026-09-20T00:00:00.000Z'],
    ['updatedAt', '2026-09-22T00:00:00.000Z'],
  ] as const)('detects changed cart field %s', (field, value) => {
    const changedCarts = changed((snapshot) => {
      snapshot.carts[0]![field] = value;
    });

    expect(violationCodes(before, changedCarts)).toContain('CART_DATA_CHANGED');
  });

  it('detects changed variant and SKU identity sets', () => {
    const changedIds = changed((snapshot) => {
      snapshot.variants[0]!.id = 'replacement-variant';
      snapshot.skus[0]!.id = 'replacement-sku';
    });

    expect(violationCodes(before, changedIds)).toEqual(
      expect.arrayContaining(['VARIANT_ID_SET_CHANGED', 'SKU_ID_SET_CHANGED']),
    );
  });

  it('detects changed SKU references or commercial data', () => {
    const changedSku = changed((snapshot) => {
      snapshot.skus[0]!.variantId = SECOND_VARIANT_ID;
      snapshot.skus[0]!.price = '1.00';
    });

    expect(violationCodes(before, changedSku)).toContain('SKU_DATA_CHANGED');
  });

  it('detects changed inventory on-hand or reserved values', () => {
    const changedInventory = changed((snapshot) => {
      snapshot.inventory[0]!.onHand = 9;
      snapshot.inventory[0]!.reserved = 4;
    });

    expect(violationCodes(before, changedInventory)).toContain(
      'INVENTORY_CHANGED',
    );
  });

  it('detects changed reservations', () => {
    const changedReservations = changed((snapshot) => {
      snapshot.reservations[0]!.quantity = 2;
    });

    expect(violationCodes(before, changedReservations)).toContain(
      'RESERVATION_CHANGED',
    );
  });

  it('detects changed inventory movements', () => {
    const changedMovements = changed((snapshot) => {
      snapshot.movements[0]!.referenceId = 'other-order';
    });

    expect(violationCodes(before, changedMovements)).toContain(
      'MOVEMENT_CHANGED',
    );
  });

  it('detects changed cart references', () => {
    const changedCart = changed((snapshot) => {
      snapshot.cartItems[0]!.skuId = SECOND_SKU_ID;
    });

    expect(violationCodes(before, changedCart)).toContain(
      'CART_REFERENCE_CHANGED',
    );
  });

  it('detects changed order and order-item references', () => {
    const changedOrder = changed((snapshot) => {
      snapshot.orderItems[0]!.variantId = SECOND_VARIANT_ID;
      snapshot.orders[0]!.grandTotal = '1.00';
    });

    expect(violationCodes(before, changedOrder)).toEqual(
      expect.arrayContaining(['ORDER_CHANGED', 'ORDER_REFERENCE_CHANGED']),
    );
  });

  it('detects changed historical order snapshots', () => {
    const changedHistory = changed((snapshot) => {
      snapshot.orderItems[0]!.variantSnapshot = 'Rewritten';
      snapshot.orderItems[0]!.optionSnapshot = { Style: 'Rewritten' };
    });

    expect(violationCodes(before, changedHistory)).toContain(
      'ORDER_HISTORY_CHANGED',
    );
  });

  it('detects changed media identity sets, ordering, and scopes', () => {
    const changedMedia = changed((snapshot) => {
      snapshot.media[0]!.id = 'replacement-image';
      snapshot.media[0]!.sortOrder = 99;
      snapshot.media[0]!.variantId = FIRST_VARIANT_ID;
    });

    expect(violationCodes(before, changedMedia)).toEqual(
      expect.arrayContaining([
        'MEDIA_ID_SET_CHANGED',
        'MEDIA_ORDER_CHANGED',
        'MEDIA_SCOPE_CHANGED',
      ]),
    );
  });

  it.each([
    [
      'OPTION_MISSING',
      (snapshot: CatalogAuditSnapshot) => snapshot.options.pop(),
    ],
    [
      'VALUE_MISSING',
      (snapshot: CatalogAuditSnapshot) => snapshot.optionValues.pop(),
    ],
    [
      'ASSIGNMENT_MISSING',
      (snapshot: CatalogAuditSnapshot) => snapshot.assignments.pop(),
    ],
  ])('detects %s', (code, mutate) => {
    expect(violationCodes(before, changed(mutate))).toContain(code);
  });

  it.each([
    [
      'OPTION_EXTRA',
      (snapshot: CatalogAuditSnapshot) =>
        snapshot.options.push({
          ...snapshot.options[0]!,
          id: 'extra-option',
          isActive: false,
        }),
    ],
    [
      'VALUE_EXTRA',
      (snapshot: CatalogAuditSnapshot) =>
        snapshot.optionValues.push({
          ...snapshot.optionValues[0]!,
          id: 'extra-value',
        }),
    ],
    [
      'ASSIGNMENT_EXTRA',
      (snapshot: CatalogAuditSnapshot) =>
        snapshot.assignments.push({
          ...snapshot.assignments[0]!,
          optionId: 'extra-option',
        }),
    ],
  ])('detects repeated or extra graph rows as %s', (code, mutate) => {
    expect(violationCodes(before, changed(mutate))).toContain(code);
  });

  it('detects missing or changed canonical combination keys', () => {
    const changedKeys = changed((snapshot) => {
      snapshot.variants[0]!.combinationKey = null;
      snapshot.variants[1]!.combinationKey = 'not-canonical';
    });

    expect(violationCodes(before, changedKeys)).toContain(
      'COMBINATION_KEY_CHANGED',
    );
  });

  it('detects a missing or changed deterministic default', () => {
    const changedDefault = changed((snapshot) => {
      snapshot.products[0]!.defaultDisplayVariantId = SECOND_VARIANT_ID;
    });

    expect(violationCodes(before, changedDefault)).toContain(
      'DEFAULT_DISPLAY_VARIANT_CHANGED',
    );
  });

  it('rejects version advancement before the required graph is complete', () => {
    const incompleteGraph = changed((snapshot) => {
      snapshot.assignments.pop();
    });

    expect(violationCodes(before, incompleteGraph)).toEqual(
      expect.arrayContaining([
        'ASSIGNMENT_MISSING',
        'CATALOG_GRAPH_VERSION_INVALID',
      ]),
    );
  });

  it('detects graph drift on an already-backfilled second run', () => {
    const driftedSecondRun = changed((snapshot) => {
      snapshot.optionValues[0]!.label = 'Drifted';
    }, after);

    expect(violationCodes(after, driftedSecondRun)).toEqual(
      expect.arrayContaining(['VALUE_CHANGED', 'SECOND_RUN_DRIFT']),
    );
  });

  it('serializes object keys, Decimal, BigInt, and Date deterministically', () => {
    const first = {
      z: 1,
      decimal: new Prisma.Decimal('12.30'),
      bigint: 42n,
      date: new Date('2026-09-21T08:09:10.123Z'),
      nested: { b: true, a: false },
    };
    const second = {
      nested: { a: false, b: true },
      date: new Date('2026-09-21T08:09:10.123Z'),
      bigint: 42n,
      decimal: new Prisma.Decimal('12.3'),
      z: 1,
    };

    expect(stableSerialize(first)).toBe(stableSerialize(second));
    expect(stableSerialize(first)).toContain('"$decimal":"12.3"');
    expect(stableSerialize(first)).toContain('"$bigint":"42"');
    expect(stableSerialize(first)).toContain(
      '"$date":"2026-09-21T08:09:10.123Z"',
    );
  });

  it('accepts a well-formed empty serialized snapshot', () => {
    const snapshot = {
      formatVersion: 1,
      products: [],
      variants: [],
      skus: [],
      inventory: [],
      reservations: [],
      movements: [],
      carts: [],
      cartItems: [],
      orders: [],
      orderItems: [],
      media: [],
      options: [],
      optionValues: [],
      assignments: [],
    };

    expect(() => validateCatalogSnapshot(snapshot)).not.toThrow();
  });

  it.each([
    'products',
    'variants',
    'skus',
    'inventory',
    'reservations',
    'movements',
    'carts',
    'cartItems',
    'orders',
    'orderItems',
    'media',
    'options',
    'optionValues',
    'assignments',
  ] as const)(
    'rejects malformed %s rows instead of trusting evidence',
    (table) => {
      const malformed: Record<string, unknown> = {
        formatVersion: 1,
        products: [],
        variants: [],
        skus: [],
        inventory: [],
        reservations: [],
        movements: [],
        carts: [],
        cartItems: [],
        orders: [],
        orderItems: [],
        media: [],
        options: [],
        optionValues: [],
        assignments: [],
      };
      malformed[table] = [{}];

      expect(() => validateCatalogSnapshot(malformed)).toThrow(
        new RegExp(`snapshot\\.${table}\\[0\\]`),
      );
    },
  );

  it('rejects missing and wrong-typed required product evidence', () => {
    const serializedProduct = {
      ...structuredClone(before.products[0]!),
      createdAt: { $date: '2026-09-20T00:00:00.000Z' },
      updatedAt: { $date: '2026-09-21T00:00:00.000Z' },
    };
    const valid = {
      formatVersion: 1,
      products: [serializedProduct],
      variants: [],
      skus: [],
      inventory: [],
      reservations: [],
      movements: [],
      carts: [],
      cartItems: [],
      orders: [],
      orderItems: [],
      media: [],
      options: [],
      optionValues: [],
      assignments: [],
    };
    expect(() => validateCatalogSnapshot(valid)).not.toThrow();

    const missingName = structuredClone(valid) as Record<string, unknown>;
    delete (missingName['products'] as Record<string, unknown>[])[0]!.name;
    expect(() => validateCatalogSnapshot(missingName)).toThrow(
      /snapshot\.products\[0\]\.name/,
    );

    const wrongVersion = structuredClone(valid) as Record<string, unknown>;
    (wrongVersion['products'] as Record<string, unknown>[])[0]![
      'catalogGraphVersion'
    ] = '1';
    expect(() => validateCatalogSnapshot(wrongVersion)).toThrow(
      /snapshot\.products\[0\]\.catalogGraphVersion/,
    );
  });

  it('rejects missing top-level arrays and unexpected evidence keys', () => {
    const malformed = {
      formatVersion: 1,
      products: [],
      variants: [],
      skus: [],
      inventory: [],
      reservations: [],
      movements: [],
      cartItems: [],
      orders: [],
      orderItems: [],
      media: [],
      options: [],
      optionValues: [],
      assignments: [],
      unexpected: [],
    };

    expect(() => validateCatalogSnapshot(malformed)).toThrow(/snapshot/);
  });

  it('validates snapshot and verify CLI arguments', () => {
    expect(parseAuditArgs(['snapshot', '--out', '/tmp/before.json'])).toEqual({
      command: 'snapshot',
      path: '/tmp/before.json',
    });
    expect(
      parseAuditArgs(['snapshot', '--', '--out', '/tmp/before.json']),
    ).toEqual({ command: 'snapshot', path: '/tmp/before.json' });
    expect(
      parseAuditArgs(['verify', '--snapshot', '/tmp/before.json']),
    ).toEqual({ command: 'verify', path: '/tmp/before.json' });
    expect(() => parseAuditArgs(['snapshot'])).toThrow(/--out/);
    expect(() =>
      parseAuditArgs(['verify', '--out', '/tmp/before.json']),
    ).toThrow(/--snapshot/);
    expect(() =>
      parseAuditArgs(['verify', '--snapshot', '/tmp/before.json', '--extra']),
    ).toThrow(/unexpected/i);
    expect(() => parseAuditArgs(['unknown'])).toThrow(/snapshot|verify/);
  });
});

const migrationUrl = new URL(
  '../prisma/migrations/20260921100000_backfill_variant_options/migration.sql',
  import.meta.url,
);

function removeSqlStatement(sql: string, marker: string): string {
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`missing test marker: ${marker}`);
  const end = sql.indexOf(';', start);
  if (end < 0) throw new Error(`unterminated test statement: ${marker}`);
  return `${sql.slice(0, start)}${sql.slice(end + 1)}`;
}

function swapSqlStatements(
  sql: string,
  firstMarker: string,
  secondMarker: string,
): string {
  const firstStart = sql.indexOf(firstMarker);
  const firstEnd = sql.indexOf(';', firstStart) + 1;
  const secondStart = sql.indexOf(secondMarker);
  const secondEnd = sql.indexOf(';', secondStart) + 1;
  if (
    firstStart < 0 ||
    secondStart < 0 ||
    firstEnd === 0 ||
    secondEnd === 0 ||
    firstEnd > secondStart
  ) {
    throw new Error('invalid test statement ordering');
  }
  const first = sql.slice(firstStart, firstEnd);
  const between = sql.slice(firstEnd, secondStart);
  const second = sql.slice(secondStart, secondEnd);
  return `${sql.slice(0, firstStart)}${second}${between}${first}${sql.slice(secondEnd)}`;
}

describe('Task 7 migration SQL contract', () => {
  it('loads and accepts the actual migration artifact', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql.trim().length).toBeGreaterThan(0);
    expect(analyzeBackfillMigrationSql(sql)).toEqual([]);
  });

  it.each([
    ['MIGRATION_EMPTY', () => '   '],
    [
      'OPTION_INSERT_MISSING',
      (sql: string) => removeSqlStatement(sql, 'INSERT INTO "product_options"'),
    ],
    [
      'VALUE_INSERT_MISSING',
      (sql: string) =>
        removeSqlStatement(sql, 'INSERT INTO "product_option_values"'),
    ],
    [
      'ASSIGNMENT_INSERT_MISSING',
      (sql: string) =>
        removeSqlStatement(sql, 'INSERT INTO "product_variant_option_values"'),
    ],
    [
      'OPTION_INSERT_INVALID',
      (sql: string) =>
        sql.replace(
          '\'STYLE\'::"ProductOptionKind"',
          '\'COLOR\'::"ProductOptionKind"',
        ),
    ],
    [
      'VALUE_INSERT_INVALID',
      (sql: string) =>
        sql.replace(
          '    pv."name",\n    pv."position",',
          "    'Wrong label',\n    99,",
        ),
    ],
    [
      'ASSIGNMENT_INSERT_INVALID',
      (sql: string) =>
        sql.replace(
          '    po."id",\n    pov."id"\nFROM "product_variants"',
          '    po."id",\n    po."id"\nFROM "product_variants"',
        ),
    ],
    [
      'CANONICAL_KEY_UPDATE_MISSING',
      (sql: string) => removeSqlStatement(sql, 'UPDATE "product_variants" pv'),
    ],
    [
      'PRODUCT_PUBLISH_UPDATE_MISSING',
      (sql: string) => removeSqlStatement(sql, 'WITH candidate_products AS'),
    ],
    [
      'PRODUCT_PUBLISH_UPDATE_INVALID',
      (sql: string) =>
        sql.replace(
          'SET "default_display_variant_id" = cp."expected_default_variant_id",',
          'SET "default_display_variant_id" = NULL,',
        ),
    ],
    [
      'PRODUCT_PUBLISH_UPDATE_INVALID',
      (sql: string) =>
        sql.replace(
          '"catalog_graph_version" = 1',
          '"catalog_graph_version" = 2',
        ),
    ],
    [
      'GRAPH_V0_SCOPE_MISSING',
      (sql: string) =>
        sql.replaceAll(
          '"catalog_graph_version" = 0',
          '"catalog_graph_version" = 9',
        ),
    ],
    [
      'DETERMINISTIC_NAMESPACE_MISSING',
      (sql: string) =>
        sql.replaceAll(
          'small-house/catalog/legacy-style-option/v1',
          'broken-option-namespace',
        ),
    ],
    [
      'DETERMINISTIC_NAMESPACE_MISSING',
      (sql: string) =>
        sql.replaceAll(
          'small-house/catalog/legacy-style-value/v1',
          'broken-value-namespace',
        ),
    ],
    [
      'REPLAY_SAFETY_MISSING',
      (sql: string) => sql.replaceAll('ON CONFLICT DO NOTHING', ''),
    ],
    [
      'IDENTITY_REWRITE_FORBIDDEN',
      (sql: string) =>
        sql.replace('COMMIT;', 'UPDATE "skus" SET "id" = "id";\nCOMMIT;'),
    ],
    [
      'IDENTITY_REWRITE_FORBIDDEN',
      (sql: string) =>
        sql.replace(
          'COMMIT;',
          'UPDATE "product_variants" SET "id" = "id";\nCOMMIT;',
        ),
    ],
    [
      'STATEMENT_ORDER_INVALID',
      (sql: string) =>
        swapSqlStatements(
          sql,
          'INSERT INTO "product_options"',
          'INSERT INTO "product_option_values"',
        ),
    ],
    [
      'TRANSACTION_BOUNDARY_INVALID',
      (sql: string) => sql.replace('BEGIN;', ''),
    ],
    [
      'CANONICAL_KEY_UPDATE_INVALID',
      (sql: string) => sql.replaceAll("|| ':' ||", '||'),
    ],
    [
      'PUBLICATION_GUARD_MISSING',
      (sql: string) =>
        sql.replace('FROM complete_products cp', 'FROM candidate_products cp'),
    ],
    [
      'DEFAULT_SELECTION_INVALID',
      (sql: string) =>
        sql.replace(
          'ORDER BY pv."position" ASC, pv."id" ASC',
          'ORDER BY pv."id" DESC',
        ),
    ],
  ])(
    'detects %s when the migration contract is mutated',
    async (code, mutate) => {
      const sql = await readFile(migrationUrl, 'utf8');

      expect(analyzeBackfillMigrationSql(mutate(sql))).toContain(code);
    },
  );
});
