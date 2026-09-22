import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import {
  canonicalCombinationKey,
  legacyUnmappedCombinationKey,
} from './catalog-graph.js';
import {
  CatalogGraphMaterializationRequiredError,
  CatalogGraphService,
} from './catalog-graph.service.js';
import { AdminProductsController } from './admin/products.controller.js';
import {
  CatalogGraphVersionMismatchError,
  CatalogGraphVersionRequiredError,
  catalogGraphPatchSchema,
  type CatalogGraphPatch,
} from './dto/catalog-graph.dto.js';
import type { UpdateProductInput } from './dto/product.dto.js';
import { ProductsService } from './products.service.js';

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const COLOR_ID = '10000000-0000-4000-8000-000000000001';
const SIZE_ID = '10000000-0000-4000-8000-000000000002';
const RED_ID = '20000000-0000-4000-8000-000000000001';
const BLUE_ID = '20000000-0000-4000-8000-000000000002';
const SMALL_ID = '20000000-0000-4000-8000-000000000003';
const RED_VARIANT_ID = '30000000-0000-4000-8000-000000000001';
const BLUE_VARIANT_ID = '30000000-0000-4000-8000-000000000002';
const RED_SKU_ID = '40000000-0000-4000-8000-000000000001';
const BLUE_SKU_ID = '40000000-0000-4000-8000-000000000002';
const SHARED_MEDIA_ID = '50000000-0000-4000-8000-000000000001';
const SYNTHETIC_OPTION_ID = '90000000-0000-4000-8000-000000000008';
const SYNTHETIC_VALUE_ID = '90000000-0000-4000-8000-000000000009';

interface OptionRow {
  id: string;
  productId: string;
  kind: 'COLOR' | 'SIZE';
  name: string;
  position: number;
  presentation: 'SWATCH' | 'TEXT';
  isMediaDriver: boolean;
  isActive: boolean;
}

interface ValueRow {
  id: string;
  productId: string;
  optionId: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
}

interface VariantRow {
  id: string;
  productId: string;
  name: string;
  position: number;
  combinationKey: string;
}

interface SkuRow {
  id: string;
  productId: string;
  variantId: string;
  skuCode: string;
  status: 'ACTIVE' | 'DISABLED';
  supplierId?: string | null;
  supplierSku?: string | null;
  supplierCost?: number | null;
  costCurrency?: string | null;
  landedCost?: number | null;
  price?: number | null;
  compareAtPrice?: number | null;
  productWeight?: number | null;
  packageWidth?: number | null;
  packageHeight?: number | null;
  packageDepth?: number | null;
  packageWeight?: number | null;
  volumetricWeight?: number | null;
}

interface AssignmentRow {
  variantId: string;
  productId: string;
  optionId: string;
  optionValueId: string;
}

interface MediaRow {
  id: string;
  productId: string;
  optionValueId: string | null;
  variantId: string | null;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  altText: string | null;
  sortOrder: number;
}

interface HistoryCounts {
  cartItems: number;
  inventory: number;
  reservations: number;
  inventoryMovements: number;
  orderItems: number;
}

interface GraphState {
  product: {
    id: string;
    name: string;
    slug: string;
    catalogGraphVersion: number;
    defaultDisplayVariantId: string | null;
  };
  detailBlocks: Array<{
    type: 'IMAGE' | 'VIDEO';
    url: string;
    altText: string | null;
    sortOrder: number;
  }>;
  options: OptionRow[];
  values: ValueRow[];
  variants: VariantRow[];
  skus: SkuRow[];
  assignments: AssignmentRow[];
  media: MediaRow[];
  history: Record<string, HistoryCounts>;
}

const noHistory = (): HistoryCounts => ({
  cartItems: 0,
  inventory: 0,
  reservations: 0,
  inventoryMovements: 0,
  orderItems: 0,
});

function combination(...pairs: Array<[string, string]>): string {
  return canonicalCombinationKey(
    pairs.map(([optionId, valueId]) => ({ optionId, valueId })),
  );
}

function baseState(
  options: {
    version?: number;
    includeBlue?: boolean;
    blueHistory?: Partial<HistoryCounts>;
  } = {},
): GraphState {
  const includeBlue = options.includeBlue ?? true;
  const state: GraphState = {
    product: {
      id: PRODUCT_ID,
      name: 'Chair',
      slug: 'chair',
      catalogGraphVersion: options.version ?? 1,
      defaultDisplayVariantId: RED_VARIANT_ID,
    },
    detailBlocks: [
      {
        type: 'IMAGE',
        url: '/uploads/original-detail.webp',
        altText: 'Original detail',
        sortOrder: 0,
      },
    ],
    options: [
      {
        id: COLOR_ID,
        productId: PRODUCT_ID,
        kind: 'COLOR',
        name: 'Color',
        position: 0,
        presentation: 'SWATCH',
        isMediaDriver: true,
        isActive: true,
      },
    ],
    values: [
      {
        id: RED_ID,
        productId: PRODUCT_ID,
        optionId: COLOR_ID,
        label: 'Red',
        position: 0,
        swatchHex: '#ff0000',
        thumbnailUrl: null,
        thumbnailAlt: null,
        isActive: true,
      },
      ...(includeBlue
        ? [
            {
              id: BLUE_ID,
              productId: PRODUCT_ID,
              optionId: COLOR_ID,
              label: 'Blue',
              position: 1,
              swatchHex: '#0000ff',
              thumbnailUrl: null,
              thumbnailAlt: null,
              isActive: true,
            } satisfies ValueRow,
          ]
        : []),
    ],
    variants: [
      {
        id: RED_VARIANT_ID,
        productId: PRODUCT_ID,
        name: 'Red',
        position: 0,
        combinationKey: combination([COLOR_ID, RED_ID]),
      },
      ...(includeBlue
        ? [
            {
              id: BLUE_VARIANT_ID,
              productId: PRODUCT_ID,
              name: 'Blue',
              position: 1,
              combinationKey: combination([COLOR_ID, BLUE_ID]),
            } satisfies VariantRow,
          ]
        : []),
    ],
    skus: [
      {
        id: RED_SKU_ID,
        productId: PRODUCT_ID,
        variantId: RED_VARIANT_ID,
        skuCode: 'CHAIR-RED',
        status: 'ACTIVE',
        price: 100,
      },
      ...(includeBlue
        ? [
            {
              id: BLUE_SKU_ID,
              productId: PRODUCT_ID,
              variantId: BLUE_VARIANT_ID,
              skuCode: 'CHAIR-BLUE',
              status: 'ACTIVE',
              price: 100,
            } satisfies SkuRow,
          ]
        : []),
    ],
    assignments: [
      {
        variantId: RED_VARIANT_ID,
        productId: PRODUCT_ID,
        optionId: COLOR_ID,
        optionValueId: RED_ID,
      },
      ...(includeBlue
        ? [
            {
              variantId: BLUE_VARIANT_ID,
              productId: PRODUCT_ID,
              optionId: COLOR_ID,
              optionValueId: BLUE_ID,
            } satisfies AssignmentRow,
          ]
        : []),
    ],
    media: [
      {
        id: SHARED_MEDIA_ID,
        productId: PRODUCT_ID,
        optionValueId: null,
        variantId: null,
        url: '/uploads/chair.webp',
        type: 'IMAGE',
        altText: 'Chair',
        sortOrder: 0,
      },
    ],
    history: {
      [RED_SKU_ID]: noHistory(),
      ...(includeBlue
        ? {
            [BLUE_SKU_ID]: {
              ...noHistory(),
              ...options.blueHistory,
            },
          }
        : {}),
    },
  };
  return state;
}

function twoOptionState(): GraphState {
  const state = baseState({ includeBlue: false });
  state.options.push({
    id: SIZE_ID,
    productId: PRODUCT_ID,
    kind: 'SIZE',
    name: 'Size',
    position: 1,
    presentation: 'TEXT',
    isMediaDriver: false,
    isActive: true,
  });
  state.values.push({
    id: SMALL_ID,
    productId: PRODUCT_ID,
    optionId: SIZE_ID,
    label: 'Small',
    position: 0,
    swatchHex: null,
    thumbnailUrl: null,
    thumbnailAlt: null,
    isActive: true,
  });
  state.variants[0].name = 'Red / Small';
  state.variants[0].combinationKey = combination(
    [COLOR_ID, RED_ID],
    [SIZE_ID, SMALL_ID],
  );
  state.assignments.push({
    variantId: RED_VARIANT_ID,
    productId: PRODUCT_ID,
    optionId: SIZE_ID,
    optionValueId: SMALL_ID,
  });
  return state;
}

function legacyState(includeBlue = true): GraphState {
  const state = baseState({ version: 0, includeBlue });
  state.options = [];
  state.values = [];
  state.assignments = [];
  state.variants.forEach((variant) => {
    variant.combinationKey = legacyUnmappedCombinationKey(variant.id);
  });
  return state;
}

function parsePatch(input: Record<string, unknown>): CatalogGraphPatch {
  return catalogGraphPatchSchema.parse(input);
}

function colorWrite(
  values: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return {
    id: COLOR_ID,
    kind: 'COLOR',
    name: 'Color',
    position: 0,
    presentation: 'SWATCH',
    isMediaDriver: true,
    isActive: true,
    values,
    ...extra,
  };
}

function materialize(state: GraphState) {
  return {
    ...state.product,
    detailBlocks: structuredClone(state.detailBlocks),
    options: [...state.options]
      .sort((left, right) => left.position - right.position)
      .map((option) => ({
        ...option,
        values: state.values
          .filter((value) => value.optionId === option.id)
          .sort((left, right) => left.position - right.position),
      })),
    variants: [...state.variants]
      .sort((left, right) => left.position - right.position)
      .map((variant) => {
        const sku =
          state.skus.find((candidate) => candidate.variantId === variant.id) ??
          null;
        return {
          ...variant,
          optionValues: state.assignments.filter(
            (assignment) => assignment.variantId === variant.id,
          ),
          sku: sku
            ? {
                ...sku,
                _count: state.history[sku.id] ?? noHistory(),
              }
            : null,
          _count: {
            images: state.media.filter(
              (media) => media.variantId === variant.id,
            ).length,
            defaultForProducts:
              state.product.defaultDisplayVariantId === variant.id ? 1 : 0,
          },
        };
      }),
    images: [...state.media].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    ),
  };
}

function rows<T>(data: T | T[]): T[] {
  return Array.isArray(data) ? data : [data];
}

function idsFromWhere(
  where: Record<string, unknown> | undefined,
): string[] | undefined {
  if (!where) return undefined;
  if (typeof where.id === 'string') return [where.id];
  const idFilter = where.id as { in?: string[] } | undefined;
  return idFilter?.in;
}

function assertOptionUnique(
  options: OptionRow[],
  next: OptionRow,
  ignoredId?: string,
): void {
  if (!next.isActive) return;
  const collision = options.some(
    (option) =>
      option.id !== ignoredId &&
      option.isActive &&
      (option.position === next.position ||
        option.name.toLowerCase() === next.name.toLowerCase() ||
        (option.isMediaDriver && next.isMediaDriver)),
  );
  if (collision) throw new Error('active option uniqueness collision');
}

function assertValueUnique(
  values: ValueRow[],
  next: ValueRow,
  ignoredId?: string,
): void {
  if (!next.isActive) return;
  const collision = values.some(
    (value) =>
      value.id !== ignoredId &&
      value.optionId === next.optionId &&
      value.isActive &&
      (value.position === next.position ||
        value.label.toLowerCase() === next.label.toLowerCase()),
  );
  if (collision) throw new Error('active option value uniqueness collision');
}

function createGraphHarness(
  initial: GraphState = baseState(),
  failAt?: 'media' | 'default',
) {
  let state = structuredClone(initial);
  let committed = false;
  let transactionCalls = 0;

  const currentProduct = () => structuredClone(materialize(state));

  const tx = {
    product: {
      updateMany: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; catalogGraphVersion: number };
        }) => {
          if (
            where.id !== state.product.id ||
            where.catalogGraphVersion !== state.product.catalogGraphVersion
          ) {
            return { count: 0 };
          }
          state.product.catalogGraphVersion += 1;
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(async () => ({
        id: state.product.id,
        catalogGraphVersion: state.product.catalogGraphVersion,
      })),
      findUniqueOrThrow: vi.fn(async () => currentProduct()),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const changesDefault =
          Object.hasOwn(data, 'defaultDisplayVariantId') ||
          Object.hasOwn(data, 'defaultDisplayVariant');
        if (failAt === 'default' && changesDefault) {
          throw new Error('default write failed');
        }
        if (Object.hasOwn(data, 'defaultDisplayVariantId')) {
          state.product.defaultDisplayVariantId =
            (data.defaultDisplayVariantId as string | null) ?? null;
        }
        if (data.defaultDisplayVariant) {
          const relation = data.defaultDisplayVariant as {
            connect?: { id?: string; id_productId?: { id: string } };
            disconnect?: boolean;
          };
          if (relation.disconnect) state.product.defaultDisplayVariantId = null;
          if (relation.connect) {
            state.product.defaultDisplayVariantId =
              relation.connect.id ?? relation.connect.id_productId?.id ?? null;
          }
        }
        if (typeof data.name === 'string') state.product.name = data.name;
        if (data.detailBlocks) {
          const mutation = data.detailBlocks as {
            create?: Array<{
              type: 'IMAGE' | 'VIDEO';
              url: string;
              altText?: string | null;
              sortOrder: number;
            }>;
          };
          state.detailBlocks = (mutation.create ?? []).map((block) => ({
            ...block,
            altText: block.altText ?? null,
          }));
        }
        return currentProduct();
      }),
    },
    productOption: {
      createMany: vi.fn(async ({ data }: { data: OptionRow | OptionRow[] }) => {
        for (const option of rows(data)) {
          assertOptionUnique(state.options, option);
          state.options.push(structuredClone(option));
        }
        return { count: rows(data).length };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<OptionRow>;
        }) => {
          const row = state.options.find(
            (candidate) => candidate.id === where.id,
          );
          if (!row) throw new Error(`missing option ${where.id}`);
          const next = { ...row, ...structuredClone(data) };
          assertOptionUnique(state.options, next, row.id);
          Object.assign(row, next);
          return structuredClone(row);
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<OptionRow>;
        }) => {
          const ids = idsFromWhere(where);
          const matches = state.options.filter(
            (row) => !ids || ids.includes(row.id),
          );
          matches.forEach((row) => Object.assign(row, structuredClone(data)));
          return { count: matches.length };
        },
      ),
    },
    productOptionValue: {
      createMany: vi.fn(async ({ data }: { data: ValueRow | ValueRow[] }) => {
        for (const value of rows(data)) {
          assertValueUnique(state.values, value);
          state.values.push(structuredClone(value));
        }
        return { count: rows(data).length };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ValueRow>;
        }) => {
          const row = state.values.find(
            (candidate) => candidate.id === where.id,
          );
          if (!row) throw new Error(`missing value ${where.id}`);
          const next = { ...row, ...structuredClone(data) };
          assertValueUnique(state.values, next, row.id);
          Object.assign(row, next);
          return structuredClone(row);
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<ValueRow>;
        }) => {
          const ids = idsFromWhere(where);
          const matches = state.values.filter(
            (row) => !ids || ids.includes(row.id),
          );
          matches.forEach((row) => Object.assign(row, structuredClone(data)));
          return { count: matches.length };
        },
      ),
    },
    productVariant: {
      createMany: vi.fn(
        async ({ data }: { data: VariantRow | VariantRow[] }) => {
          state.variants.push(...structuredClone(rows(data)));
          return { count: rows(data).length };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<VariantRow>;
        }) => {
          const row = state.variants.find(
            (candidate) => candidate.id === where.id,
          );
          if (!row) throw new Error(`missing variant ${where.id}`);
          if (
            data.name &&
            state.variants.some(
              (candidate) =>
                candidate.id !== row.id && candidate.name === data.name,
            )
          ) {
            throw new Error(`duplicate variant name ${data.name}`);
          }
          Object.assign(row, structuredClone(data));
          return structuredClone(row);
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const ids = idsFromWhere(where) ?? [];
          const before = state.variants.length;
          state.variants = state.variants.filter(
            (row) => !ids.includes(row.id),
          );
          const deletedSkuIds = state.skus
            .filter((sku) => ids.includes(sku.variantId))
            .map((sku) => sku.id);
          state.skus = state.skus.filter((sku) => !ids.includes(sku.variantId));
          state.assignments = state.assignments.filter(
            (assignment) => !ids.includes(assignment.variantId),
          );
          deletedSkuIds.forEach((id) => delete state.history[id]);
          return { count: before - state.variants.length };
        },
      ),
    },
    sku: {
      createMany: vi.fn(async ({ data }: { data: SkuRow | SkuRow[] }) => {
        state.skus.push(...structuredClone(rows(data)));
        for (const sku of rows(data)) state.history[sku.id] = noHistory();
        return { count: rows(data).length };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<SkuRow>;
        }) => {
          const row = state.skus.find((candidate) => candidate.id === where.id);
          if (!row) throw new Error(`missing sku ${where.id}`);
          Object.assign(row, structuredClone(data));
          return structuredClone(row);
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<SkuRow>;
        }) => {
          const variantIds = (where.variantId as { in?: string[] } | undefined)
            ?.in;
          const skuIds = idsFromWhere(where);
          const matches = state.skus.filter(
            (row) =>
              (!variantIds || variantIds.includes(row.variantId)) &&
              (!skuIds || skuIds.includes(row.id)),
          );
          matches.forEach((row) => Object.assign(row, structuredClone(data)));
          return { count: matches.length };
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const ids = idsFromWhere(where) ?? [];
          const before = state.skus.length;
          state.skus = state.skus.filter((row) => !ids.includes(row.id));
          ids.forEach((id) => delete state.history[id]);
          return { count: before - state.skus.length };
        },
      ),
    },
    productVariantOptionValue: {
      deleteMany: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const variantIds =
            (where.variantId as { in?: string[] } | undefined)?.in ?? [];
          const before = state.assignments.length;
          state.assignments = state.assignments.filter(
            (row) => !variantIds.includes(row.variantId),
          );
          return { count: before - state.assignments.length };
        },
      ),
      createMany: vi.fn(
        async ({ data }: { data: AssignmentRow | AssignmentRow[] }) => {
          state.assignments.push(...structuredClone(rows(data)));
          return { count: rows(data).length };
        },
      ),
    },
    productImage: {
      createMany: vi.fn(async ({ data }: { data: MediaRow | MediaRow[] }) => {
        if (failAt === 'media') throw new Error('media write failed');
        state.media.push(...structuredClone(rows(data)));
        return { count: rows(data).length };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MediaRow>;
        }) => {
          if (failAt === 'media') throw new Error('media write failed');
          const row = state.media.find(
            (candidate) => candidate.id === where.id,
          );
          if (!row) throw new Error(`missing media ${where.id}`);
          Object.assign(row, structuredClone(data));
          return structuredClone(row);
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const ids = idsFromWhere(where) ?? [];
          const before = state.media.length;
          state.media = state.media.filter((row) => !ids.includes(row.id));
          return { count: before - state.media.length };
        },
      ),
    },
  };

  const prisma = {
    product: {
      findUnique: vi.fn(async () => currentProduct()),
    },
    productOption: {
      findMany: vi.fn(
        async () => [] as Array<{ id: string; productId: string }>,
      ),
    },
    productOptionValue: {
      findMany: vi.fn(
        async () => [] as Array<{ id: string; productId: string }>,
      ),
    },
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => {
        transactionCalls += 1;
        const before = structuredClone(state);
        committed = false;
        try {
          const result = await callback(tx);
          committed = true;
          return result;
        } catch (error) {
          state = before;
          committed = false;
          throw error;
        }
      },
    ),
  };

  const service = new CatalogGraphService(prisma as never);
  return {
    service,
    prisma,
    tx,
    get state() {
      return state;
    },
    get committed() {
      return committed;
    },
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

function findVariant(result: unknown, id: string) {
  return (result as ReturnType<typeof materialize>).variants.find(
    (variant) => variant.id === id,
  );
}

function renameRedPatch(label = 'Crimson') {
  return parsePatch({
    options: [
      colorWrite([
        {
          id: RED_ID,
          label,
          position: 0,
          swatchHex: '#aa0000',
          isActive: true,
        },
      ]),
    ],
  });
}

function addBluePatch() {
  return parsePatch({
    options: [
      colorWrite([
        {
          clientKey: 'value-blue',
          label: 'Blue',
          position: 1,
          swatchHex: '#0000ff',
          isActive: true,
        },
      ]),
    ],
    variants: [
      {
        clientKey: 'variant-blue',
        position: 1,
        optionValueRefs: [{ clientKey: 'value-blue' }],
        sku: {
          skuCode: 'CHAIR-BLUE',
          status: 'ACTIVE',
          price: 120,
        },
      },
    ],
    media: [
      {
        clientKey: 'media-blue',
        url: '/uploads/chair-blue.webp',
        type: 'IMAGE',
        sortOrder: 0,
        variantClientKey: 'variant-blue',
      },
    ],
    defaultDisplayVariant: { clientKey: 'variant-blue' },
  });
}

function materializeLegacyPatch(
  options: {
    includeBlue?: boolean;
    includeGreen?: boolean;
  } = {},
) {
  const includeBlue = options.includeBlue ?? true;
  const includeGreen = options.includeGreen ?? false;
  const values: Array<Record<string, unknown>> = [
    {
      clientKey: 'legacy-red-value',
      label: 'Red',
      position: 0,
      swatchHex: '#ff0000',
      isActive: true,
    },
  ];
  if (includeBlue) {
    values.push({
      clientKey: 'legacy-blue-value',
      label: 'Blue',
      position: 1,
      swatchHex: '#0000ff',
      isActive: true,
    });
  }
  if (includeGreen) {
    values.push({
      clientKey: 'legacy-green-value',
      label: 'Green',
      position: 2,
      swatchHex: '#00aa00',
      isActive: true,
    });
  }

  return parsePatch({
    options: [
      {
        clientKey: 'legacy-color-option',
        kind: 'COLOR',
        name: 'Color',
        position: 0,
        presentation: 'SWATCH',
        isMediaDriver: true,
        isActive: true,
        values,
      },
    ],
    variants: [
      {
        id: RED_VARIANT_ID,
        position: 0,
        optionValueRefs: [{ clientKey: 'legacy-red-value' }],
      },
      ...(includeBlue
        ? [
            {
              id: BLUE_VARIANT_ID,
              position: 1,
              optionValueRefs: [{ clientKey: 'legacy-blue-value' }],
            },
          ]
        : []),
    ],
  });
}

function materializationPatchWithSyntheticId(
  entryPoint: 'option' | 'value' | 'variant-value-ref' | 'media-value-scope',
): CatalogGraphPatch {
  const patch = materializeLegacyPatch();
  if (entryPoint === 'option') {
    const option = patch.options[0] as unknown as Record<string, unknown>;
    delete option.clientKey;
    option.id = SYNTHETIC_OPTION_ID;
  } else if (entryPoint === 'value') {
    const value = patch.options[0].values[0] as unknown as Record<
      string,
      unknown
    >;
    delete value.clientKey;
    value.id = SYNTHETIC_VALUE_ID;
  } else if (entryPoint === 'variant-value-ref') {
    patch.variants[0].optionValueRefs = [{ id: SYNTHETIC_VALUE_ID }];
  } else {
    patch.media.push({
      clientKey: 'synthetic-value-media',
      url: '/uploads/synthetic-value.webp',
      type: 'IMAGE',
      altText: null,
      sortOrder: 0,
      optionValueId: SYNTHETIC_VALUE_ID,
    });
  }
  return patch;
}

beforeEach(() => {
  vi.mocked(revalidateCache).mockReset();
  vi.mocked(revalidateCache).mockResolvedValue(undefined);
});

describe('CatalogGraphService.applyPatch', () => {
  it('retains variant and SKU identity for the same combination and derives renamed labels server-side', async () => {
    const harness = createGraphHarness();

    const result = await harness.service.applyPatch(
      PRODUCT_ID,
      1,
      renameRedPatch(),
    );

    const variant = findVariant(result, RED_VARIANT_ID);
    expect(variant).toMatchObject({
      id: RED_VARIANT_ID,
      name: 'Crimson',
      combinationKey: combination([COLOR_ID, RED_ID]),
      sku: { id: RED_SKU_ID, skuCode: 'CHAIR-RED' },
    });
    expect((result as ReturnType<typeof materialize>).catalogGraphVersion).toBe(
      2,
    );
  });

  it('keeps the same variant and SKU when option display order changes', async () => {
    const harness = createGraphHarness(twoOptionState());
    const patch = parsePatch({
      options: [
        colorWrite(
          [
            {
              id: RED_ID,
              label: 'Red',
              position: 0,
              swatchHex: '#ff0000',
              isActive: true,
            },
          ],
          { position: 1, isMediaDriver: true },
        ),
        {
          id: SIZE_ID,
          kind: 'SIZE',
          name: 'Size',
          position: 0,
          presentation: 'TEXT',
          isMediaDriver: false,
          isActive: true,
          values: [
            {
              id: SMALL_ID,
              label: 'Small',
              position: 0,
              isActive: true,
            },
          ],
        },
      ],
    });

    const result = await harness.service.applyPatch(PRODUCT_ID, 1, patch);

    expect(findVariant(result, RED_VARIANT_ID)).toMatchObject({
      id: RED_VARIANT_ID,
      name: 'Small / Red',
      combinationKey: combination([COLOR_ID, RED_ID], [SIZE_ID, SMALL_ID]),
      sku: { id: RED_SKU_ID },
    });
  });

  it('parks existing names before a label swap so unique names never collide', async () => {
    const harness = createGraphHarness();
    const patch = parsePatch({
      options: [
        colorWrite([
          {
            id: RED_ID,
            label: 'Blue',
            position: 0,
            swatchHex: '#0000ff',
            isActive: true,
          },
          {
            id: BLUE_ID,
            label: 'Red',
            position: 1,
            swatchHex: '#ff0000',
            isActive: true,
          },
        ]),
      ],
    });

    const result = await harness.service.applyPatch(PRODUCT_ID, 1, patch);

    expect(findVariant(result, RED_VARIANT_ID)).toMatchObject({
      id: RED_VARIANT_ID,
      name: 'Blue',
      sku: { id: RED_SKU_ID },
    });
    expect(findVariant(result, BLUE_VARIANT_ID)).toMatchObject({
      id: BLUE_VARIANT_ID,
      name: 'Red',
      sku: { id: BLUE_SKU_ID },
    });
  });

  it('preallocates stable IDs for a new combination, its SKU, media scope, and default', async () => {
    const harness = createGraphHarness(baseState({ includeBlue: false }));

    const result = (await harness.service.applyPatch(
      PRODUCT_ID,
      1,
      addBluePatch(),
    )) as ReturnType<typeof materialize> & { media: MediaRow[] };

    const created = result.variants.find(
      (variant) =>
        variant.combinationKey ===
        combination([COLOR_ID, result.options[0].values[1].id]),
    );
    expect(created).toMatchObject({
      name: 'Blue',
      sku: { skuCode: 'CHAIR-BLUE' },
    });
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created?.sku?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.defaultDisplayVariantId).toBe(created?.id);
    expect(result.images).toEqual([
      expect.objectContaining({ id: SHARED_MEDIA_ID }),
    ]);
    expect(result.media).toContainEqual(
      expect.objectContaining({
        url: '/uploads/chair-blue.webp',
        variantId: created?.id,
      }),
    );
  });

  it.each([
    ['empty', () => parsePatch({})],
    [
      'shared-media-only',
      () =>
        parsePatch({
          media: [
            {
              clientKey: 'new-shared-media',
              url: '/uploads/new-shared.webp',
              type: 'IMAGE',
              sortOrder: 1,
            },
          ],
        }),
    ],
  ])(
    'rejects an incomplete %s graph-v0 materialization before mutation',
    async (_label, patchFactory) => {
      const harness = createGraphHarness(legacyState());
      const before = structuredClone(harness.state);

      await expect(
        harness.service.applyPatch(PRODUCT_ID, 0, patchFactory()),
      ).rejects.toMatchObject({
        code: 'CATALOG_GRAPH_MATERIALIZATION_REQUIRED',
      });

      expect(harness.transactionCalls).toBe(0);
      expect(harness.state).toEqual(before);
      expect(revalidateCache).not.toHaveBeenCalled();
    },
  );

  it('uses the materialization error when a listed legacy variant does not resolve to a final candidate', async () => {
    const harness = createGraphHarness(legacyState());
    const patch = materializeLegacyPatch();
    patch.variants[1].optionValueRefs = [];
    const before = structuredClone(harness.state);

    await expect(
      harness.service.applyPatch(PRODUCT_ID, 0, patch),
    ).rejects.toMatchObject({
      code: 'CATALOG_GRAPH_MATERIALIZATION_REQUIRED',
    });
    expect(harness.transactionCalls).toBe(0);
    expect(harness.state).toEqual(before);
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it.each([
    'option',
    'value',
    'variant-value-ref',
    'media-value-scope',
  ] as const)(
    'rejects synthetic read-projection IDs at the %s entry point with the materialization error',
    async (entryPoint) => {
      const harness = createGraphHarness(legacyState());
      const patch = materializationPatchWithSyntheticId(entryPoint);
      const before = structuredClone(harness.state);

      await expect(
        harness.service.applyPatch(PRODUCT_ID, 0, patch),
      ).rejects.toMatchObject({
        code: 'CATALOG_GRAPH_MATERIALIZATION_REQUIRED',
      });
      expect(harness.transactionCalls).toBe(0);
      expect(harness.state).toEqual(before);
      expect(revalidateCache).not.toHaveBeenCalled();
    },
  );

  it('keeps cross-product persisted option identities as generic ownership errors', async () => {
    const harness = createGraphHarness(legacyState());
    harness.prisma.productOption.findMany.mockResolvedValue([
      {
        id: SYNTHETIC_OPTION_ID,
        productId: '00000000-0000-4000-8000-000000000099',
      },
    ]);
    const patch = materializationPatchWithSyntheticId('option');

    await expect(
      harness.service.applyPatch(PRODUCT_ID, 0, patch),
    ).rejects.toMatchObject({ status: 400 });
    expect(harness.transactionCalls).toBe(0);
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('allows persisted variant IDs for complete mappings, media, and default display', async () => {
    const harness = createGraphHarness(legacyState());
    const patch = materializeLegacyPatch();
    patch.media.push({
      clientKey: 'legacy-red-variant-media',
      url: '/uploads/legacy-red.webp',
      type: 'IMAGE',
      altText: null,
      sortOrder: 0,
      variantId: RED_VARIANT_ID,
    });
    patch.defaultDisplayVariant = { id: RED_VARIANT_ID };

    const result = (await harness.service.applyPatch(
      PRODUCT_ID,
      0,
      patch,
    )) as ReturnType<typeof materialize> & { media: MediaRow[] };

    const materializedOption = result.options[0];
    const materializedRed = materializedOption.values.find(
      ({ label }) => label === 'Red',
    )!;
    expect(findVariant(result, RED_VARIANT_ID)).toMatchObject({
      id: RED_VARIANT_ID,
      combinationKey: combination([materializedOption.id, materializedRed.id]),
      sku: { id: RED_SKU_ID },
    });
    expect(result.defaultDisplayVariantId).toBe(RED_VARIANT_ID);
    expect(result.media).toContainEqual(
      expect.objectContaining({
        url: '/uploads/legacy-red.webp',
        variantId: RED_VARIANT_ID,
      }),
    );
  });

  it.each([
    [
      'malformed sentinel',
      `${legacyUnmappedCombinationKey(RED_VARIANT_ID)}:suffix`,
    ],
    ['another variant sentinel', legacyUnmappedCombinationKey(BLUE_VARIANT_ID)],
  ])('rejects reassignment from a %s', async (_label, persistedKey) => {
    const state = legacyState(false);
    state.variants[0].combinationKey = persistedKey;
    const harness = createGraphHarness(state);
    const before = structuredClone(harness.state);

    await expect(
      harness.service.applyPatch(
        PRODUCT_ID,
        0,
        materializeLegacyPatch({ includeBlue: false }),
      ),
    ).rejects.toThrow(/cannot be reassigned to a different combination/i);

    expect(harness.transactionCalls).toBe(0);
    expect(harness.state).toEqual(before);
  });

  it('does not treat a null persisted key as a replaceable sentinel', async () => {
    const state = legacyState(false);
    state.variants[0].combinationKey = null as unknown as string;
    const harness = createGraphHarness(state);
    const before = structuredClone(harness.state);

    await expect(
      harness.service.applyPatch(
        PRODUCT_ID,
        0,
        materializeLegacyPatch({ includeBlue: false }),
      ),
    ).rejects.toThrow(/cannot be reassigned to a different combination/i);

    expect(harness.transactionCalls).toBe(0);
    expect(harness.state).toEqual(before);
  });

  it('keeps canonical keys immutable after graph materialization', async () => {
    const harness = createGraphHarness();
    const patch = parsePatch({
      variants: [
        {
          id: RED_VARIANT_ID,
          position: 0,
          optionValueRefs: [{ id: BLUE_ID }],
        },
      ],
    });

    await expect(
      harness.service.applyPatch(PRODUCT_ID, 1, patch),
    ).rejects.toThrow(/cannot be reassigned to a different combination/i);
    expect(harness.transactionCalls).toBe(0);
  });

  it('fully materializes every legacy variant by persisted ID and creates only additional candidates', async () => {
    const harness = createGraphHarness(legacyState());

    const result = (await harness.service.applyPatch(
      PRODUCT_ID,
      0,
      materializeLegacyPatch({ includeGreen: true }),
    )) as ReturnType<typeof materialize>;

    expect(findVariant(result, RED_VARIANT_ID)).toMatchObject({
      id: RED_VARIANT_ID,
      name: 'Red',
      sku: { id: RED_SKU_ID },
    });
    expect(findVariant(result, BLUE_VARIANT_ID)).toMatchObject({
      id: BLUE_VARIANT_ID,
      name: 'Blue',
      sku: { id: BLUE_SKU_ID },
    });
    const additional = result.variants.find(
      (variant) =>
        variant.id !== RED_VARIANT_ID && variant.id !== BLUE_VARIANT_ID,
    );
    expect(additional).toMatchObject({ name: 'Green', sku: null });
    expect(result.catalogGraphVersion).toBe(1);
  });

  it('materializes a single legacy default into typed options without replacing its variant or SKU', async () => {
    const harness = createGraphHarness(legacyState(false));

    const result = await harness.service.applyPatch(
      PRODUCT_ID,
      0,
      materializeLegacyPatch({ includeBlue: false }),
    );

    expect(findVariant(result, RED_VARIANT_ID)).toMatchObject({
      id: RED_VARIANT_ID,
      name: 'Red',
      sku: { id: RED_SKU_ID },
    });
    expect((result as ReturnType<typeof materialize>).variants).toHaveLength(1);
  });

  it('preserves and disables an existing SKU when a retained combination clears it', async () => {
    const harness = createGraphHarness();
    const patch = parsePatch({
      variants: [
        {
          id: RED_VARIANT_ID,
          position: 0,
          optionValueRefs: [{ id: RED_ID }],
          sku: null,
        },
      ],
    });

    const result = await harness.service.applyPatch(PRODUCT_ID, 1, patch);

    expect(findVariant(result, RED_VARIANT_ID)).toMatchObject({
      id: RED_VARIANT_ID,
      sku: { id: RED_SKU_ID, status: 'DISABLED' },
    });
  });

  it('disables a retired variant with history instead of deleting its identities', async () => {
    const harness = createGraphHarness(
      baseState({ blueHistory: { orderItems: 1 } }),
    );
    const patch = parsePatch({
      retirements: { optionValueIds: [BLUE_ID] },
    });

    const result = await harness.service.applyPatch(PRODUCT_ID, 1, patch);

    expect(findVariant(result, BLUE_VARIANT_ID)).toMatchObject({
      id: BLUE_VARIANT_ID,
      sku: { id: BLUE_SKU_ID, status: 'DISABLED' },
    });
  });

  it('deletes a retired history-free variant and SKU', async () => {
    const harness = createGraphHarness();
    const patch = parsePatch({
      retirements: { optionValueIds: [BLUE_ID] },
      defaultDisplayVariant: { id: RED_VARIANT_ID },
    });

    const result = (await harness.service.applyPatch(
      PRODUCT_ID,
      1,
      patch,
    )) as ReturnType<typeof materialize>;

    expect(
      result.variants.some((variant) => variant.id === BLUE_VARIANT_ID),
    ).toBe(false);
    expect(harness.state.skus.some((sku) => sku.id === BLUE_SKU_ID)).toBe(
      false,
    );
  });

  it.each(['media', 'default'] as const)(
    'rolls back the revision and every graph write when the %s write fails',
    async (failure) => {
      const harness = createGraphHarness(
        baseState({ includeBlue: false }),
        failure,
      );
      const before = structuredClone(harness.state);

      await expect(
        harness.service.applyPatch(PRODUCT_ID, 1, addBluePatch()),
      ).rejects.toThrow(`${failure} write failed`);

      expect(harness.state).toEqual(before);
      expect(revalidateCache).not.toHaveBeenCalled();
    },
  );

  it('requires an expected revision before reading or opening a transaction', async () => {
    const harness = createGraphHarness();

    await expect(
      harness.service.applyPatch(
        PRODUCT_ID,
        undefined as unknown as number,
        renameRedPatch(),
      ),
    ).rejects.toBeInstanceOf(CatalogGraphVersionRequiredError);
    expect(harness.prisma.product.findUnique).not.toHaveBeenCalled();
    expect(harness.transactionCalls).toBe(0);
  });

  it('rejects a stale revision with the current version from inside the transaction', async () => {
    const harness = createGraphHarness(baseState({ version: 5 }));
    const before = structuredClone(harness.state);

    await expect(
      harness.service.applyPatch(PRODUCT_ID, 4, renameRedPatch()),
    ).rejects.toMatchObject({
      code: 'CATALOG_GRAPH_VERSION_MISMATCH',
      expectedVersion: 4,
      actualVersion: 5,
    });
    expect(harness.state).toEqual(before);
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('resolves ownership before the transaction and rejects a foreign persisted ref', async () => {
    const harness = createGraphHarness();
    const patch = parsePatch({
      defaultDisplayVariant: {
        id: '90000000-0000-4000-8000-000000000001',
      },
    });

    await expect(
      harness.service.applyPatch(PRODUCT_ID, 1, patch),
    ).rejects.toThrow(/variant.*product/i);
    expect(harness.transactionCalls).toBe(0);
  });

  it('revalidates exactly once and only after the transaction commits', async () => {
    const harness = createGraphHarness();
    vi.mocked(revalidateCache).mockImplementation(async (tags) => {
      expect(harness.committed).toBe(true);
      expect(tags).toEqual([CACHE_TAGS.STOREFRONT]);
    });

    await harness.service.applyPatch(PRODUCT_ID, 1, renameRedPatch());

    expect(revalidateCache).toHaveBeenCalledTimes(1);
  });
});

function createProductsHarness(catalogGraphVersion: number) {
  const existingVariant = {
    id: RED_VARIANT_ID,
    name: 'Red',
    position: 0,
    sku: { id: RED_SKU_ID, skuCode: 'CHAIR-RED' },
  };
  const saved = {
    id: PRODUCT_ID,
    slug: 'chair',
    catalogGraphVersion,
    variants: [existingVariant],
  };
  const tx = {
    product: {
      update: vi.fn(async () => saved),
      findUniqueOrThrow: vi.fn(async () => saved),
    },
    productVariant: {
      findMany: vi.fn(async () => [existingVariant]),
      update: vi.fn(async () => existingVariant),
      create: vi.fn(),
      delete: vi.fn(),
    },
    sku: {
      update: vi.fn(async () => existingVariant.sku),
      create: vi.fn(),
      delete: vi.fn(),
    },
  };
  const prisma = {
    product: {
      findUnique: vi.fn(async () => ({ id: PRODUCT_ID, catalogGraphVersion })),
    },
    category: { findUnique: vi.fn() },
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const reviews = { summaryForProducts: vi.fn(async () => new Map()) };
  const inventory = { stockBySku: vi.fn(async () => new Map()) };
  const graphResult = {
    ...saved,
    catalogGraphVersion: catalogGraphVersion + 1,
  };
  const graph = {
    applyPatch: vi.fn(async () => graphResult),
    applyPatchWithProductMutation: vi.fn(
      async (
        _id: string,
        _version: number,
        _patch: CatalogGraphPatch,
        mutate: (client: typeof tx) => Promise<void>,
      ) => {
        await mutate(tx);
        return graphResult;
      },
    ),
  };
  const service = new ProductsService(
    prisma as never,
    reviews as never,
    inventory as never,
    graph as never,
  );
  return { service, prisma, tx, graph };
}

function createMixedProductsHarness(
  state: GraphState,
  failAt?: 'media' | 'default',
) {
  const graphHarness = createGraphHarness(state, failAt);
  const reviews = { summaryForProducts: vi.fn(async () => new Map()) };
  const inventory = { stockBySku: vi.fn(async () => new Map()) };
  const service = new ProductsService(
    graphHarness.prisma as never,
    reviews as never,
    inventory as never,
    graphHarness.service,
  );
  return {
    products: service,
    get state() {
      return graphHarness.state;
    },
    get transactionCalls() {
      return graphHarness.transactionCalls;
    },
  };
}

const legacyVariantInput = [
  {
    name: 'Red',
    position: 0,
    sku: { skuCode: 'CHAIR-RED', status: 'ACTIVE' as const },
  },
];

describe('ProductsService catalog graph routing', () => {
  it('rolls back mixed scalar and detail changes when the graph revision is stale', async () => {
    const harness = createMixedProductsHarness(baseState({ version: 5 }));
    const before = structuredClone(harness.state);

    await expect(
      harness.products.update(PRODUCT_ID, {
        name: 'Changed chair',
        detailBlocks: [
          {
            type: 'VIDEO',
            url: '/uploads/changed-detail.mp4',
            altText: 'Changed detail',
            sortOrder: 0,
          },
        ],
        catalogGraph: renameRedPatch(),
        catalogGraphVersion: 4,
      }),
    ).rejects.toMatchObject({
      code: 'CATALOG_GRAPH_VERSION_MISMATCH',
      actualVersion: 5,
    });

    expect(harness.state).toEqual(before);
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('rolls back mixed scalar and detail changes when a late graph write fails', async () => {
    const harness = createMixedProductsHarness(
      baseState({ includeBlue: false }),
      'media',
    );
    const before = structuredClone(harness.state);

    await expect(
      harness.products.update(PRODUCT_ID, {
        name: 'Changed chair',
        detailBlocks: [
          {
            type: 'VIDEO',
            url: '/uploads/changed-detail.mp4',
            altText: 'Changed detail',
            sortOrder: 0,
          },
        ],
        catalogGraph: addBluePatch(),
        catalogGraphVersion: 1,
      }),
    ).rejects.toThrow('media write failed');

    expect(harness.state).toEqual(before);
    expect(revalidateCache).not.toHaveBeenCalled();
  });

  it('commits a mixed scalar/detail graph save in one transaction and revalidates once', async () => {
    const harness = createMixedProductsHarness(baseState());

    const result = await harness.products.update(PRODUCT_ID, {
      name: 'Changed chair',
      detailBlocks: [
        {
          type: 'VIDEO',
          url: '/uploads/changed-detail.mp4',
          altText: 'Changed detail',
          sortOrder: 0,
        },
      ],
      catalogGraph: renameRedPatch(),
      catalogGraphVersion: 1,
    });

    expect(harness.transactionCalls).toBe(1);
    expect(harness.state.product.name).toBe('Changed chair');
    expect(harness.state.detailBlocks).toEqual([
      {
        type: 'VIDEO',
        url: '/uploads/changed-detail.mp4',
        altText: 'Changed detail',
        sortOrder: 0,
      },
    ]);
    expect(findVariant(result, RED_VARIANT_ID)).toMatchObject({
      name: 'Crimson',
      sku: { id: RED_SKU_ID },
    });
    expect(revalidateCache).toHaveBeenCalledTimes(1);
  });

  it('keeps graph-v0 products on the legacy reconcile path', async () => {
    const { service, tx, graph } = createProductsHarness(0);

    await service.update(PRODUCT_ID, {
      variants: legacyVariantInput,
    } as UpdateProductInput);

    expect(tx.productVariant.findMany).toHaveBeenCalledTimes(1);
    expect(graph.applyPatchWithProductMutation).not.toHaveBeenCalled();
  });

  it('rejects an old-Admin whole-list payload for a graph-aware product', async () => {
    const { service, prisma, graph } = createProductsHarness(2);

    await expect(
      service.update(PRODUCT_ID, {
        variants: legacyVariantInput,
        images: [
          {
            url: '/uploads/legacy.webp',
            type: 'IMAGE',
            sortOrder: 0,
          },
        ],
      } as UpdateProductInput),
    ).rejects.toBeInstanceOf(CatalogGraphVersionRequiredError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(graph.applyPatchWithProductMutation).not.toHaveBeenCalled();
  });

  it('requires a revision whenever catalogGraph is supplied', async () => {
    const { service, prisma, graph } = createProductsHarness(1);

    await expect(
      service.update(PRODUCT_ID, {
        catalogGraph: parsePatch({}),
      } as UpdateProductInput),
    ).rejects.toBeInstanceOf(CatalogGraphVersionRequiredError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(graph.applyPatchWithProductMutation).not.toHaveBeenCalled();
  });

  it('routes graph writes without running legacy image or variant replacement', async () => {
    const { service, tx, graph } = createProductsHarness(2);
    const patch = parsePatch({});

    await service.update(PRODUCT_ID, {
      catalogGraph: patch,
      catalogGraphVersion: 2,
      variants: legacyVariantInput,
      images: [
        {
          url: '/uploads/legacy.webp',
          type: 'IMAGE',
          sortOrder: 0,
        },
      ],
    } as UpdateProductInput);

    expect(graph.applyPatchWithProductMutation).toHaveBeenCalledWith(
      PRODUCT_ID,
      2,
      patch,
      expect.any(Function),
    );
    expect(tx.productVariant.findMany).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ images: expect.anything() }),
      }),
    );
  });

  it('keeps unrelated non-graph updates working on graph-aware products', async () => {
    const { service, prisma, graph } = createProductsHarness(2);

    await service.update(PRODUCT_ID, { description: 'edited' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(graph.applyPatchWithProductMutation).not.toHaveBeenCalled();
  });
});

describe('AdminProductsController catalog revision conflicts', () => {
  it.each([
    new CatalogGraphVersionRequiredError(),
    new CatalogGraphVersionMismatchError(4, 5),
    new CatalogGraphMaterializationRequiredError(),
  ])('maps %s to a named 409 response', async (domainError) => {
    const controller = new AdminProductsController({
      update: vi.fn(async () => {
        throw domainError;
      }),
    } as never);

    let thrown: unknown;
    try {
      await controller.update(PRODUCT_ID, {} as UpdateProductInput);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toMatchObject({
      code: domainError.code,
    });
  });
});
