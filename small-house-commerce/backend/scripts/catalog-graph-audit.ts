import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

const LEGACY_STYLE_OPTION_NAMESPACE =
  'small-house/catalog/legacy-style-option/v1';
const LEGACY_STYLE_VALUE_NAMESPACE =
  'small-house/catalog/legacy-style-value/v1';

interface AuditRecord {
  id: string;
  [key: string]: unknown;
}

export interface AuditProductRow {
  id: string;
  catalogGraphVersion: number;
  defaultDisplayVariantId: string | null;
  [key: string]: unknown;
}

export interface AuditVariantRow {
  id: string;
  productId: string;
  name: string;
  position: number;
  combinationKey: string | null;
  [key: string]: unknown;
}

export interface AuditSkuRow {
  id: string;
  productId: string;
  variantId: string;
  skuCode: string;
  status: string;
  price: unknown | null;
  compareAtPrice: unknown | null;
  [key: string]: unknown;
}

export interface AuditMediaRow extends AuditRecord {
  productId: string;
  optionValueId: string | null;
  variantId: string | null;
  sortOrder: number;
}

export interface AuditOptionRow extends AuditRecord {
  productId: string;
  kind: string;
  name: string;
  position: number;
  presentation: string;
  isMediaDriver: boolean;
  isActive: boolean;
}

export interface AuditOptionValueRow extends AuditRecord {
  productId: string;
  optionId: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
}

export interface AuditAssignmentRow {
  variantId: string;
  productId: string;
  optionId: string;
  optionValueId: string;
  [key: string]: unknown;
}

export interface CatalogAuditSnapshot {
  formatVersion: 1;
  products: AuditProductRow[];
  variants: AuditVariantRow[];
  skus: AuditSkuRow[];
  inventory: AuditRecord[];
  reservations: AuditRecord[];
  movements: AuditRecord[];
  cartItems: AuditRecord[];
  orders: AuditRecord[];
  orderItems: AuditRecord[];
  media: AuditMediaRow[];
  options: AuditOptionRow[];
  optionValues: AuditOptionValueRow[];
  assignments: AuditAssignmentRow[];
}

export interface CatalogAuditViolation {
  code: string;
}

export type CatalogAuditArgs =
  { command: 'snapshot'; path: string } | { command: 'verify'; path: string };

function namespacedMd5Uuid(namespace: string, sourceId: string): string {
  const hex = createHash('md5')
    .update(`${namespace}:${sourceId}`, 'utf8')
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function legacyStyleOptionId(productId: string): string {
  return namespacedMd5Uuid(LEGACY_STYLE_OPTION_NAMESPACE, productId);
}

export function legacyStyleValueId(variantId: string): string {
  return namespacedMd5Uuid(LEGACY_STYLE_VALUE_NAMESPACE, variantId);
}

function normalizeForStableJson(value: unknown): unknown {
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }
  if (Prisma.Decimal.isDecimal(value)) {
    return { $decimal: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForStableJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [
          key,
          normalizeForStableJson(nestedValue),
        ]),
    );
  }
  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

export function catalogSnapshotFingerprint(
  snapshot: CatalogAuditSnapshot,
): string {
  return createHash('sha256').update(stableSerialize(snapshot)).digest('hex');
}

function sortedRows<T>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) =>
    stableSerialize(left).localeCompare(stableSerialize(right)),
  );
}

function rowsEqual(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return (
    stableSerialize(sortedRows(left)) === stableSerialize(sortedRows(right))
  );
}

function identitySet(rows: readonly AuditRecord[]): string[] {
  return rows.map((row) => row.id).sort();
}

function pick(row: AuditRecord, keys: readonly string[]): AuditRecord {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as AuditRecord;
}

function withoutKeys(
  row: AuditRecord,
  excludedKeys: ReadonlySet<string>,
): AuditRecord {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !excludedKeys.has(key)),
  ) as AuditRecord;
}

function assignmentIdentity(row: AuditAssignmentRow): string {
  return `${row.variantId}:${row.optionId}`;
}

function rowMap<T>(
  rows: readonly T[],
  identity: (row: T) => string,
): Map<string, T> {
  return new Map(rows.map((row) => [identity(row), row]));
}

function matchingFields(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(
    ([key, expectedValue]) =>
      stableSerialize(actual[key]) === stableSerialize(expectedValue),
  );
}

interface GraphComparisonCodes {
  missing: string;
  extra: string;
  changed: string;
}

function compareGraphRows<T>(
  expectedRows: readonly T[],
  actualRows: readonly T[],
  identity: (row: T) => string,
  codes: GraphComparisonCodes,
  add: (code: string) => void,
  allowActualMetadata: boolean,
): boolean {
  const expected = rowMap(expectedRows, identity);
  const actual = rowMap(actualRows, identity);
  const missing = [...expected.keys()].some((key) => !actual.has(key));
  const extra = [...actual.keys()].some((key) => !expected.has(key));

  if (missing) add(codes.missing);
  if (extra) add(codes.extra);

  let changed = false;
  for (const [key, expectedRow] of expected) {
    const actualRow = actual.get(key);
    if (actualRow === undefined) continue;
    const equal = allowActualMetadata
      ? matchingFields(
          actualRow as Record<string, unknown>,
          expectedRow as Record<string, unknown>,
        )
      : stableSerialize(actualRow) === stableSerialize(expectedRow);
    if (!equal) {
      changed = true;
      add(codes.changed);
      break;
    }
  }

  return !missing && !extra && !changed;
}

function expectedDefaultVariantId(
  variants: readonly AuditVariantRow[],
  skus: readonly AuditSkuRow[],
): string | null {
  const skuByVariantId = new Map(skus.map((sku) => [sku.variantId, sku]));
  return (
    [...variants]
      .sort(
        (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      )
      .find((variant) => {
        const sku = skuByVariantId.get(variant.id);
        return sku?.status === 'ACTIVE' && sku.price !== null;
      })?.id ?? null
  );
}

function compareLegacyTarget(
  product: AuditProductRow,
  baseline: CatalogAuditSnapshot,
  candidate: CatalogAuditSnapshot,
  add: (code: string) => void,
): void {
  const variants = baseline.variants.filter(
    (variant) => variant.productId === product.id,
  );
  const optionId = legacyStyleOptionId(product.id);
  const expectedOptions: AuditOptionRow[] = [
    {
      id: optionId,
      productId: product.id,
      kind: 'STYLE',
      name: 'Style',
      position: 0,
      presentation: 'TEXT',
      isMediaDriver: false,
      isActive: true,
    },
  ];
  const expectedValues: AuditOptionValueRow[] = variants.map((variant) => ({
    id: legacyStyleValueId(variant.id),
    productId: product.id,
    optionId,
    label: variant.name,
    position: variant.position,
    swatchHex: null,
    thumbnailUrl: null,
    thumbnailAlt: null,
    isActive: true,
  }));
  const expectedAssignments: AuditAssignmentRow[] = variants.map((variant) => ({
    variantId: variant.id,
    productId: product.id,
    optionId,
    optionValueId: legacyStyleValueId(variant.id),
  }));
  const actualOptions = candidate.options.filter(
    (option) => option.productId === product.id,
  );
  const actualValues = candidate.optionValues.filter(
    (value) => value.productId === product.id,
  );
  const actualAssignments = candidate.assignments.filter(
    (assignment) => assignment.productId === product.id,
  );

  const optionsComplete = compareGraphRows(
    expectedOptions,
    actualOptions,
    (option) => option.id,
    {
      missing: 'OPTION_MISSING',
      extra: 'OPTION_EXTRA',
      changed: 'OPTION_CHANGED',
    },
    add,
    true,
  );
  const valuesComplete = compareGraphRows(
    expectedValues,
    actualValues,
    (value) => value.id,
    {
      missing: 'VALUE_MISSING',
      extra: 'VALUE_EXTRA',
      changed: 'VALUE_CHANGED',
    },
    add,
    true,
  );
  const assignmentsComplete = compareGraphRows(
    expectedAssignments,
    actualAssignments,
    assignmentIdentity,
    {
      missing: 'ASSIGNMENT_MISSING',
      extra: 'ASSIGNMENT_EXTRA',
      changed: 'ASSIGNMENT_CHANGED',
    },
    add,
    false,
  );

  const candidateVariants = rowMap(
    candidate.variants.filter((variant) => variant.productId === product.id),
    (variant) => variant.id,
  );
  const keysComplete = variants.every((variant) => {
    const expectedKey = `${optionId}:${legacyStyleValueId(variant.id)}`;
    return candidateVariants.get(variant.id)?.combinationKey === expectedKey;
  });
  if (!keysComplete) add('COMBINATION_KEY_CHANGED');

  const expectedDefault = expectedDefaultVariantId(
    variants,
    baseline.skus.filter((sku) => sku.productId === product.id),
  );
  const candidateProduct = candidate.products.find(
    (row) => row.id === product.id,
  );
  const defaultComplete =
    candidateProduct?.defaultDisplayVariantId === expectedDefault;
  if (!defaultComplete) add('DEFAULT_DISPLAY_VARIANT_CHANGED');

  if (
    candidateProduct?.catalogGraphVersion !== 1 ||
    !optionsComplete ||
    !valuesComplete ||
    !assignmentsComplete ||
    !keysComplete ||
    !defaultComplete
  ) {
    add('CATALOG_GRAPH_VERSION_INVALID');
  }
}

function comparePersistedGraph(
  productId: string,
  baseline: CatalogAuditSnapshot,
  candidate: CatalogAuditSnapshot,
  add: (code: string) => void,
): void {
  let drifted = false;
  const compare = <T>(
    expectedRows: readonly T[],
    actualRows: readonly T[],
    identity: (row: T) => string,
    codes: GraphComparisonCodes,
  ): void => {
    if (
      !compareGraphRows(expectedRows, actualRows, identity, codes, add, false)
    ) {
      drifted = true;
    }
  };

  compare(
    baseline.options.filter((row) => row.productId === productId),
    candidate.options.filter((row) => row.productId === productId),
    (row) => row.id,
    {
      missing: 'OPTION_MISSING',
      extra: 'OPTION_EXTRA',
      changed: 'OPTION_CHANGED',
    },
  );
  compare(
    baseline.optionValues.filter((row) => row.productId === productId),
    candidate.optionValues.filter((row) => row.productId === productId),
    (row) => row.id,
    {
      missing: 'VALUE_MISSING',
      extra: 'VALUE_EXTRA',
      changed: 'VALUE_CHANGED',
    },
  );
  compare(
    baseline.assignments.filter((row) => row.productId === productId),
    candidate.assignments.filter((row) => row.productId === productId),
    assignmentIdentity,
    {
      missing: 'ASSIGNMENT_MISSING',
      extra: 'ASSIGNMENT_EXTRA',
      changed: 'ASSIGNMENT_CHANGED',
    },
  );

  const baselineProduct = baseline.products.find((row) => row.id === productId);
  const candidateProduct = candidate.products.find(
    (row) => row.id === productId,
  );
  if (
    baselineProduct?.catalogGraphVersion !==
    candidateProduct?.catalogGraphVersion
  ) {
    add('CATALOG_GRAPH_VERSION_INVALID');
    drifted = true;
  }
  if (
    baselineProduct?.defaultDisplayVariantId !==
    candidateProduct?.defaultDisplayVariantId
  ) {
    add('DEFAULT_DISPLAY_VARIANT_CHANGED');
    drifted = true;
  }

  const baselineKeys = baseline.variants
    .filter((row) => row.productId === productId)
    .map((row) => ({ id: row.id, combinationKey: row.combinationKey }));
  const candidateKeys = candidate.variants
    .filter((row) => row.productId === productId)
    .map((row) => ({ id: row.id, combinationKey: row.combinationKey }));
  if (!rowsEqual(baselineKeys, candidateKeys)) {
    add('COMBINATION_KEY_CHANGED');
    drifted = true;
  }

  if (drifted) add('SECOND_RUN_DRIFT');
}

export function compareCatalogSnapshots(
  baseline: CatalogAuditSnapshot,
  candidate: CatalogAuditSnapshot,
): CatalogAuditViolation[] {
  const codes = new Set<string>();
  const add = (code: string): void => {
    codes.add(code);
  };

  if (
    !rowsEqual(identitySet(baseline.products), identitySet(candidate.products))
  ) {
    add('PRODUCT_ID_SET_CHANGED');
  }
  if (
    !rowsEqual(identitySet(baseline.variants), identitySet(candidate.variants))
  ) {
    add('VARIANT_ID_SET_CHANGED');
  }
  if (!rowsEqual(identitySet(baseline.skus), identitySet(candidate.skus))) {
    add('SKU_ID_SET_CHANGED');
  }

  const legacyProductIds = new Set(
    baseline.products
      .filter(
        (product) =>
          product.catalogGraphVersion === 0 &&
          baseline.variants.some((variant) => variant.productId === product.id),
      )
      .map((product) => product.id),
  );

  const baselineVariantData = baseline.variants.map((variant) =>
    legacyProductIds.has(variant.productId)
      ? withoutKeys(variant, new Set(['combinationKey']))
      : variant,
  );
  const candidateVariantData = candidate.variants.map((variant) =>
    legacyProductIds.has(variant.productId)
      ? withoutKeys(variant, new Set(['combinationKey']))
      : variant,
  );
  if (!rowsEqual(baselineVariantData, candidateVariantData)) {
    add('VARIANT_DATA_CHANGED');
  }
  if (!rowsEqual(baseline.skus, candidate.skus)) add('SKU_DATA_CHANGED');
  if (!rowsEqual(baseline.inventory, candidate.inventory)) {
    add('INVENTORY_CHANGED');
  }
  if (!rowsEqual(baseline.reservations, candidate.reservations)) {
    add('RESERVATION_CHANGED');
  }
  if (!rowsEqual(baseline.movements, candidate.movements)) {
    add('MOVEMENT_CHANGED');
  }
  if (!rowsEqual(baseline.cartItems, candidate.cartItems)) {
    add('CART_REFERENCE_CHANGED');
  }
  if (!rowsEqual(baseline.orders, candidate.orders)) add('ORDER_CHANGED');

  const orderReferenceKeys = [
    'id',
    'orderId',
    'productId',
    'variantId',
    'skuId',
    'quantity',
  ] as const;
  const baselineOrderReferences = baseline.orderItems.map((row) =>
    pick(row, orderReferenceKeys),
  );
  const candidateOrderReferences = candidate.orderItems.map((row) =>
    pick(row, orderReferenceKeys),
  );
  if (!rowsEqual(baselineOrderReferences, candidateOrderReferences)) {
    add('ORDER_REFERENCE_CHANGED');
  }
  const historicalKeys = [
    'id',
    'productNameSnapshot',
    'skuCodeSnapshot',
    'variantSnapshot',
    'optionSnapshot',
    'unitPrice',
    'unitDiscount',
    'unitCostSnapshot',
    'lineTotal',
    'createdAt',
  ] as const;
  const baselineHistory = baseline.orderItems.map((row) =>
    pick(row, historicalKeys),
  );
  const candidateHistory = candidate.orderItems.map((row) =>
    pick(row, historicalKeys),
  );
  if (!rowsEqual(baselineHistory, candidateHistory)) {
    add('ORDER_HISTORY_CHANGED');
  }

  if (!rowsEqual(identitySet(baseline.media), identitySet(candidate.media))) {
    add('MEDIA_ID_SET_CHANGED');
  }
  const mediaOrderKeys = ['id', 'productId', 'sortOrder'] as const;
  if (
    !rowsEqual(
      baseline.media.map((row) => pick(row, mediaOrderKeys)),
      candidate.media.map((row) => pick(row, mediaOrderKeys)),
    )
  ) {
    add('MEDIA_ORDER_CHANGED');
  }
  const mediaScopeKeys = [
    'id',
    'productId',
    'optionValueId',
    'variantId',
  ] as const;
  if (
    !rowsEqual(
      baseline.media.map((row) => pick(row, mediaScopeKeys)),
      candidate.media.map((row) => pick(row, mediaScopeKeys)),
    )
  ) {
    add('MEDIA_SCOPE_CHANGED');
  }
  const mediaMutableKeys = new Set(['sortOrder', 'optionValueId', 'variantId']);
  if (
    !rowsEqual(
      baseline.media.map((row) => withoutKeys(row, mediaMutableKeys)),
      candidate.media.map((row) => withoutKeys(row, mediaMutableKeys)),
    )
  ) {
    add('MEDIA_DATA_CHANGED');
  }

  for (const product of baseline.products) {
    if (legacyProductIds.has(product.id)) {
      compareLegacyTarget(product, baseline, candidate, add);
    } else {
      comparePersistedGraph(product.id, baseline, candidate, add);
    }
  }

  return [...codes].sort().map((code) => ({ code }));
}

export function parseAuditArgs(argv: readonly string[]): CatalogAuditArgs {
  const [command, ...commandArgs] = argv;
  const normalizedArgs =
    commandArgs[0] === '--' ? commandArgs.slice(1) : commandArgs;
  const [flag, path, ...extra] = normalizedArgs;
  if (command !== 'snapshot' && command !== 'verify') {
    throw new Error('command must be snapshot or verify');
  }
  const expectedFlag = command === 'snapshot' ? '--out' : '--snapshot';
  if (flag !== expectedFlag || path === undefined || path.length === 0) {
    throw new Error(`${command} requires ${expectedFlag} <path>`);
  }
  if (extra.length > 0) {
    throw new Error(`unexpected arguments: ${extra.join(' ')}`);
  }
  return { command, path };
}

export async function captureCatalogSnapshot(
  prisma: PrismaClient,
): Promise<CatalogAuditSnapshot> {
  return prisma.$transaction(
    async (tx) => {
      const [
        products,
        variants,
        skus,
        inventory,
        reservations,
        movements,
        cartItems,
        orders,
        orderItems,
        media,
        options,
        optionValues,
        assignments,
      ] = await Promise.all([
        tx.product.findMany({ orderBy: { id: 'asc' } }),
        tx.productVariant.findMany({ orderBy: { id: 'asc' } }),
        tx.sku.findMany({ orderBy: { id: 'asc' } }),
        tx.inventory.findMany({ orderBy: { id: 'asc' } }),
        tx.inventoryReservation.findMany({ orderBy: { id: 'asc' } }),
        tx.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
        tx.cartItem.findMany({ orderBy: { id: 'asc' } }),
        tx.order.findMany({ orderBy: { id: 'asc' } }),
        tx.orderItem.findMany({ orderBy: { id: 'asc' } }),
        tx.productImage.findMany({ orderBy: { id: 'asc' } }),
        tx.productOption.findMany({ orderBy: { id: 'asc' } }),
        tx.productOptionValue.findMany({ orderBy: { id: 'asc' } }),
        tx.productVariantOptionValue.findMany({
          orderBy: [{ variantId: 'asc' }, { optionId: 'asc' }],
        }),
      ]);

      return {
        formatVersion: 1,
        products,
        variants,
        skus,
        inventory,
        reservations,
        movements,
        cartItems,
        orders,
        orderItems,
        media,
        options,
        optionValues,
        assignments,
      } as unknown as CatalogAuditSnapshot;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function assertSnapshot(value: unknown): asserts value is CatalogAuditSnapshot {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { formatVersion?: unknown }).formatVersion !== 1
  ) {
    throw new Error('snapshot has an unsupported or missing formatVersion');
  }
  const requiredArrays = [
    'products',
    'variants',
    'skus',
    'inventory',
    'reservations',
    'movements',
    'cartItems',
    'orders',
    'orderItems',
    'media',
    'options',
    'optionValues',
    'assignments',
  ] as const;
  for (const key of requiredArrays) {
    if (!Array.isArray((value as Record<string, unknown>)[key])) {
      throw new Error(`snapshot field ${key} must be an array`);
    }
  }
}

async function runCli(argv: readonly string[]): Promise<number> {
  const args = parseAuditArgs(argv);
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    await prisma.$connect();
    if (args.command === 'snapshot') {
      const snapshot = await captureCatalogSnapshot(prisma);
      await writeFile(args.path, `${stableSerialize(snapshot)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      console.log(
        `catalog snapshot PASS ${catalogSnapshotFingerprint(snapshot)} ${args.path}`,
      );
      return 0;
    }

    const parsed = JSON.parse(await readFile(args.path, 'utf8')) as unknown;
    assertSnapshot(parsed);
    const current = await captureCatalogSnapshot(prisma);
    const violations = compareCatalogSnapshots(parsed, current);
    if (violations.length > 0) {
      console.error(
        `catalog audit FAIL ${violations.map(({ code }) => code).join(',')}`,
      );
      return 1;
    }
    console.log(
      `catalog audit PASS ${catalogSnapshotFingerprint(current)} ${args.path}`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
