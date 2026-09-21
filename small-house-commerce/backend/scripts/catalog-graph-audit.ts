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
  carts: AuditRecord[];
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

export function analyzeBackfillMigrationSql(sql: string): string[] {
  const violations = new Set<string>();
  const normalized = sql.trim();
  if (normalized.length === 0) return ['MIGRATION_EMPTY'];

  const markers = {
    option: 'INSERT INTO "product_options"',
    value: 'INSERT INTO "product_option_values"',
    assignment: 'INSERT INTO "product_variant_option_values"',
    key: 'UPDATE "product_variants" pv',
    publish: 'WITH candidate_products AS',
  } as const;
  const indexes = Object.fromEntries(
    Object.entries(markers).map(([name, marker]) => [
      name,
      sql.indexOf(marker),
    ]),
  ) as Record<keyof typeof markers, number>;
  const missingCodes: Record<keyof typeof markers, string> = {
    option: 'OPTION_INSERT_MISSING',
    value: 'VALUE_INSERT_MISSING',
    assignment: 'ASSIGNMENT_INSERT_MISSING',
    key: 'CANONICAL_KEY_UPDATE_MISSING',
    publish: 'PRODUCT_PUBLISH_UPDATE_MISSING',
  };
  for (const name of Object.keys(markers) as (keyof typeof markers)[]) {
    if (indexes[name] < 0) violations.add(missingCodes[name]);
  }

  if (!/^BEGIN\s*;/i.test(normalized) || !/COMMIT\s*;$/i.test(normalized)) {
    violations.add('TRANSACTION_BOUNDARY_INVALID');
  }
  const orderedIndexes = [
    indexes.option,
    indexes.value,
    indexes.assignment,
    indexes.key,
    indexes.publish,
  ];
  if (
    orderedIndexes.some((index) => index < 0) ||
    orderedIndexes.some(
      (index, position) =>
        position > 0 && index <= orderedIndexes[position - 1]!,
    )
  ) {
    violations.add('STATEMENT_ORDER_INVALID');
  }

  const statementAt = (index: number): string => {
    if (index < 0) return '';
    const end = sql.indexOf(';', index);
    return end < 0 ? sql.slice(index) : sql.slice(index, end + 1);
  };
  const optionStatement = statementAt(indexes.option);
  const valueStatement = statementAt(indexes.value);
  const assignmentStatement = statementAt(indexes.assignment);
  const keyStatement = statementAt(indexes.key);
  const publishStatement = statementAt(indexes.publish);
  const inserts = [optionStatement, valueStatement, assignmentStatement];

  if (
    !sql.includes(LEGACY_STYLE_OPTION_NAMESPACE) ||
    !sql.includes(LEGACY_STYLE_VALUE_NAMESPACE) ||
    !optionStatement.includes(LEGACY_STYLE_OPTION_NAMESPACE) ||
    !valueStatement.includes(LEGACY_STYLE_VALUE_NAMESPACE) ||
    !assignmentStatement.includes(LEGACY_STYLE_VALUE_NAMESPACE)
  ) {
    violations.add('DETERMINISTIC_NAMESPACE_MISSING');
  }
  if (
    inserts.some(
      (statement) =>
        !/INSERT INTO[\s\S]+SELECT[\s\S]+ON CONFLICT DO NOTHING\s*;/i.test(
          statement,
        ),
    )
  ) {
    violations.add('REPLAY_SAFETY_MISSING');
  }
  if (
    optionStatement.length > 0 &&
    (!optionStatement.includes(LEGACY_STYLE_OPTION_NAMESPACE) ||
      !/'STYLE'::"ProductOptionKind"/.test(optionStatement) ||
      !/\n\s*'Style',\s*\n\s*0,/.test(optionStatement) ||
      !/'TEXT'::"ProductOptionPresentation"/.test(optionStatement) ||
      !/\n\s*false,\s*\n\s*true,/.test(optionStatement))
  ) {
    violations.add('OPTION_INSERT_INVALID');
  }
  if (
    valueStatement.length > 0 &&
    (!valueStatement.includes(LEGACY_STYLE_VALUE_NAMESPACE) ||
      !valueStatement.includes(LEGACY_STYLE_OPTION_NAMESPACE) ||
      !/pv\."name",\s*\n\s*pv\."position",/.test(valueStatement) ||
      !/\n\s*NULL,\s*\n\s*NULL,\s*\n\s*NULL,\s*\n\s*true,/.test(valueStatement))
  ) {
    violations.add('VALUE_INSERT_INVALID');
  }
  if (
    assignmentStatement.length > 0 &&
    !/SELECT\s+pv\."id",\s*pv\."product_id",\s*po\."id",\s*pov\."id"/i.test(
      assignmentStatement,
    )
  ) {
    violations.add('ASSIGNMENT_INSERT_INVALID');
  }
  if (
    [
      optionStatement,
      valueStatement,
      assignmentStatement,
      keyStatement,
      publishStatement,
    ].some(
      (statement) =>
        statement.length > 0 &&
        !/"catalog_graph_version"\s*=\s*0/i.test(statement),
    )
  ) {
    violations.add('GRAPH_V0_SCOPE_MISSING');
  }
  if (
    keyStatement.length > 0 &&
    (!/SET\s+"combination_key"\s*=/i.test(keyStatement) ||
      !keyStatement.includes(LEGACY_STYLE_OPTION_NAMESPACE) ||
      !keyStatement.includes(LEGACY_STYLE_VALUE_NAMESPACE) ||
      !/\|\|\s*':'\s*\|\|/.test(keyStatement))
  ) {
    violations.add('CANONICAL_KEY_UPDATE_INVALID');
  }
  if (
    publishStatement.length > 0 &&
    (!/UPDATE\s+"products"\s+p/i.test(publishStatement) ||
      !/SET\s+"default_display_variant_id"\s*=\s*cp\."expected_default_variant_id",/i.test(
        publishStatement,
      ) ||
      !/"catalog_graph_version"\s*=\s*1/i.test(publishStatement))
  ) {
    violations.add('PRODUCT_PUBLISH_UPDATE_INVALID');
  }
  if (
    publishStatement.length > 0 &&
    (!/FROM\s+complete_products\s+cp/i.test(publishStatement) ||
      !/complete_products\s+AS/i.test(publishStatement) ||
      !/count\(\*\)/i.test(publishStatement) ||
      !/NOT EXISTS/i.test(publishStatement))
  ) {
    violations.add('PUBLICATION_GUARD_MISSING');
  }
  if (
    publishStatement.length > 0 &&
    (!/s\."status"\s*=\s*'ACTIVE'::"SkuStatus"/i.test(publishStatement) ||
      !/s\."price"\s+IS NOT NULL/i.test(publishStatement) ||
      !/ORDER BY\s+pv\."position"\s+ASC,\s*pv\."id"\s+ASC/i.test(
        publishStatement,
      ))
  ) {
    violations.add('DEFAULT_SELECTION_INVALID');
  }

  if (
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"skus"/i.test(
      sql,
    ) ||
    /(?:INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"product_variants"/i.test(
      sql,
    )
  ) {
    violations.add('IDENTITY_REWRITE_FORBIDDEN');
  }
  const variantUpdates = [
    ...sql.matchAll(/UPDATE\s+"product_variants"[\s\S]*?;/gi),
  ];
  if (
    variantUpdates.some(([statement]) => {
      const setClause = statement.match(/SET([\s\S]*?)FROM/i)?.[1] ?? '';
      return (
        !/^\s*"combination_key"\s*=/i.test(setClause) ||
        /"(?:id|product_id)"\s*=/i.test(setClause)
      );
    })
  ) {
    violations.add('IDENTITY_REWRITE_FORBIDDEN');
  }

  return [...violations].sort();
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

  const productGraphKeys = new Set([
    'catalogGraphVersion',
    'defaultDisplayVariantId',
  ]);
  if (
    !rowsEqual(
      baseline.products.map((product) =>
        withoutKeys(product, productGraphKeys),
      ),
      candidate.products.map((product) =>
        withoutKeys(product, productGraphKeys),
      ),
    )
  ) {
    add('PRODUCT_DATA_CHANGED');
  }
  if (!rowsEqual(identitySet(baseline.carts), identitySet(candidate.carts))) {
    add('CART_ID_SET_CHANGED');
  }
  if (!rowsEqual(baseline.carts, candidate.carts)) {
    add('CART_DATA_CHANGED');
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
        carts,
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
        tx.cart.findMany({ orderBy: { id: 'asc' } }),
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
        carts,
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

type FieldValidator = (value: unknown) => boolean;
type RowContract = Readonly<Record<string, FieldValidator>>;

const isString: FieldValidator = (value) => typeof value === 'string';
const isNumber: FieldValidator = (value) =>
  typeof value === 'number' && Number.isFinite(value);
const isInteger: FieldValidator = (value) =>
  typeof value === 'number' && Number.isInteger(value);
const isBoolean: FieldValidator = (value) => typeof value === 'boolean';
const isStringArray: FieldValidator = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const nullable =
  (validator: FieldValidator): FieldValidator =>
  (value) =>
    value === null || validator(value);
const isTaggedString =
  (tag: '$date' | '$decimal'): FieldValidator =>
  (value) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[tag] === 'string';
const isDate = isTaggedString('$date');
const isDecimal = isTaggedString('$decimal');
const isJson: FieldValidator = () => true;

const snapshotRowContracts = {
  products: {
    id: isString,
    name: isString,
    slug: isString,
    description: nullable(isString),
    tagline: nullable(isString),
    categoryId: isString,
    status: isString,
    room: nullable(isString),
    internalRole: nullable(isString),
    solutions: isStringArray,
    width: nullable(isNumber),
    height: nullable(isNumber),
    depth: nullable(isNumber),
    foldedWidth: nullable(isNumber),
    foldedHeight: nullable(isNumber),
    foldedDepth: nullable(isNumber),
    materials: nullable(isString),
    features: nullable(isString),
    catalogGraphVersion: isInteger,
    defaultDisplayVariantId: nullable(isString),
    createdAt: isDate,
    updatedAt: isDate,
  },
  variants: {
    id: isString,
    productId: isString,
    name: isString,
    position: isInteger,
    combinationKey: nullable(isString),
    createdAt: isDate,
    updatedAt: isDate,
  },
  skus: {
    id: isString,
    productId: isString,
    variantId: isString,
    skuCode: isString,
    status: isString,
    supplierId: nullable(isString),
    supplierSku: nullable(isString),
    supplierCost: nullable(isDecimal),
    costCurrency: nullable(isString),
    landedCost: nullable(isDecimal),
    price: nullable(isDecimal),
    compareAtPrice: nullable(isDecimal),
    productWeight: nullable(isNumber),
    packageWidth: nullable(isNumber),
    packageHeight: nullable(isNumber),
    packageDepth: nullable(isNumber),
    packageWeight: nullable(isNumber),
    volumetricWeight: nullable(isNumber),
    createdAt: isDate,
    updatedAt: isDate,
  },
  inventory: {
    id: isString,
    skuId: isString,
    warehouseId: isString,
    onHand: isInteger,
    reserved: isInteger,
    updatedAt: isDate,
  },
  reservations: {
    id: isString,
    orderId: isString,
    skuId: isString,
    warehouseId: isString,
    quantity: isInteger,
    status: isString,
    createdAt: isDate,
  },
  movements: {
    id: isString,
    skuId: isString,
    warehouseId: isString,
    movementType: isString,
    quantity: isInteger,
    referenceType: nullable(isString),
    referenceId: nullable(isString),
    operatorId: nullable(isString),
    reason: nullable(isString),
    createdAt: isDate,
  },
  carts: {
    id: isString,
    expiresAt: isDate,
    createdAt: isDate,
    updatedAt: isDate,
  },
  cartItems: {
    id: isString,
    cartId: isString,
    skuId: isString,
    quantity: isInteger,
    createdAt: isDate,
  },
  orders: {
    id: isString,
    orderNumber: isString,
    customerId: isString,
    orderStatus: isString,
    confirmationStatus: isString,
    paymentStatus: isString,
    currency: isString,
    subtotal: isDecimal,
    discountTotal: isDecimal,
    shippingTotal: isDecimal,
    grandTotal: isDecimal,
    optimizerId: nullable(isString),
    optimizerAidSnapshot: nullable(isString),
    optimizerNameSnapshot: nullable(isString),
    customerClassification: nullable(isString),
    confirmedBy: nullable(isString),
    confirmedAt: nullable(isDate),
    confirmationNote: nullable(isString),
    assignedToId: nullable(isString),
    assignedBy: nullable(isString),
    assignedAt: nullable(isDate),
    createdAt: isDate,
    updatedAt: isDate,
    preferredDeliveryDate: nullable(isDate),
  },
  orderItems: {
    id: isString,
    orderId: isString,
    productId: nullable(isString),
    variantId: nullable(isString),
    skuId: isString,
    productNameSnapshot: isString,
    skuCodeSnapshot: isString,
    variantSnapshot: isString,
    optionSnapshot: isJson,
    quantity: isInteger,
    unitPrice: isDecimal,
    unitDiscount: isDecimal,
    unitCostSnapshot: nullable(isDecimal),
    lineTotal: isDecimal,
    createdAt: isDate,
  },
  media: {
    id: isString,
    productId: isString,
    optionValueId: nullable(isString),
    variantId: nullable(isString),
    url: isString,
    type: isString,
    altText: nullable(isString),
    sortOrder: isInteger,
    createdAt: isDate,
  },
  options: {
    id: isString,
    productId: isString,
    kind: isString,
    name: isString,
    position: isInteger,
    presentation: isString,
    isMediaDriver: isBoolean,
    isActive: isBoolean,
    createdAt: isDate,
    updatedAt: isDate,
  },
  optionValues: {
    id: isString,
    productId: isString,
    optionId: isString,
    label: isString,
    position: isInteger,
    swatchHex: nullable(isString),
    thumbnailUrl: nullable(isString),
    thumbnailAlt: nullable(isString),
    isActive: isBoolean,
    createdAt: isDate,
    updatedAt: isDate,
  },
  assignments: {
    variantId: isString,
    productId: isString,
    optionId: isString,
    optionValueId: isString,
  },
} as const satisfies Record<string, RowContract>;

function validateRow(
  value: unknown,
  contract: RowContract,
  path: string,
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const row = value as Record<string, unknown>;
  const expectedKeys = Object.keys(contract).sort();
  const actualKeys = Object.keys(row).sort();
  if (stableSerialize(actualKeys) !== stableSerialize(expectedKeys)) {
    const missing = expectedKeys.find(
      (key) => !Object.prototype.hasOwnProperty.call(row, key),
    );
    throw new Error(
      missing === undefined
        ? `${path} has unexpected fields`
        : `${path}.${missing} is required`,
    );
  }
  for (const [field, validator] of Object.entries(contract)) {
    if (!validator(row[field])) {
      throw new Error(`${path}.${field} has an invalid type`);
    }
  }
}

export function validateCatalogSnapshot(
  value: unknown,
): asserts value is CatalogAuditSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('snapshot must be an object');
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot['formatVersion'] !== 1) {
    throw new Error('snapshot has an unsupported or missing formatVersion');
  }
  const expectedKeys = [
    'formatVersion',
    ...Object.keys(snapshotRowContracts),
  ].sort();
  const actualKeys = Object.keys(snapshot).sort();
  if (stableSerialize(actualKeys) !== stableSerialize(expectedKeys)) {
    throw new Error('snapshot has missing or unexpected top-level fields');
  }
  for (const [table, contract] of Object.entries(snapshotRowContracts)) {
    const rows = snapshot[table];
    if (!Array.isArray(rows)) {
      throw new Error(`snapshot field ${table} must be an array`);
    }
    rows.forEach((row, index) =>
      validateRow(row, contract, `snapshot.${table}[${index}]`),
    );
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
    validateCatalogSnapshot(parsed);
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
