import { z } from 'zod';
import { siteMediaUrl } from '../../../common/site-media-url.js';
import {
  DetailBlockType,
  ProductOptionKind,
  ProductOptionPresentation,
  SkuStatus,
} from '../../../generated/prisma/client.js';
import {
  CatalogGraphValidationError,
  validateCatalogGraph,
} from '../catalog-graph.js';

const uuidSchema = z.string().uuid();
const clientKeySchema = z.string().min(1);

/** A persisted row uses its UUID; a new row uses a request-local client key. */
export const entityRefSchema = z.union([
  z.object({ id: uuidSchema, clientKey: z.never().optional() }),
  z.object({ clientKey: clientKeySchema, id: z.never().optional() }),
]);

export type EntityRef = z.infer<typeof entityRefSchema>;

const optionValueFieldsSchema = z.object({
  label: z.string().trim().min(1).max(120),
  position: z.number().int().nonnegative(),
  swatchHex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  thumbnailUrl: siteMediaUrl().nullable().optional(),
  thumbnailAlt: z.string().max(255).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const optionValueWriteSchema = entityRefSchema.and(
  optionValueFieldsSchema,
);

const optionFieldsSchema = z.object({
  kind: z.nativeEnum(ProductOptionKind),
  name: z.string().trim().min(1).max(120),
  position: z.number().int().nonnegative(),
  presentation: z.nativeEnum(ProductOptionPresentation),
  isMediaDriver: z.boolean().default(false),
  isActive: z.boolean().default(true),
  values: z.array(optionValueWriteSchema).default([]),
});

export const optionWriteSchema = entityRefSchema.and(optionFieldsSchema);

export const skuWriteSchema = z.object({
  skuCode: z.string().trim().min(1).max(64),
  status: z.nativeEnum(SkuStatus).default('ACTIVE'),
  supplierId: uuidSchema.nullable().optional(),
  supplierSku: z.string().max(120).nullable().optional(),
  supplierCost: z.number().nonnegative().nullable().optional(),
  costCurrency: z.string().max(8).nullable().optional(),
  landedCost: z.number().nonnegative().nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  compareAtPrice: z.number().nonnegative().nullable().optional(),
  productWeight: z.number().nonnegative().nullable().optional(),
  packageWidth: z.number().nonnegative().nullable().optional(),
  packageHeight: z.number().nonnegative().nullable().optional(),
  packageDepth: z.number().nonnegative().nullable().optional(),
  packageWeight: z.number().nonnegative().nullable().optional(),
  volumetricWeight: z.number().nonnegative().nullable().optional(),
});

const variantFieldsSchema = z.object({
  position: z.number().int().nonnegative(),
  optionValueRefs: z.array(entityRefSchema).max(2).default([]),
  sku: skuWriteSchema.nullable().optional(),
});

export const variantWriteSchema = entityRefSchema.and(variantFieldsSchema);

const mediaFieldsSchema = z
  .object({
    url: siteMediaUrl(),
    type: z.nativeEnum(DetailBlockType).default('IMAGE'),
    altText: z.string().max(255).nullable().optional(),
    sortOrder: z.number().int().nonnegative().default(0),
    optionValueId: uuidSchema.optional(),
    optionValueClientKey: clientKeySchema.optional(),
    variantId: uuidSchema.optional(),
    variantClientKey: clientKeySchema.optional(),
  })
  .superRefine((media, ctx) => {
    const optionValueRefCount =
      Number(media.optionValueId !== undefined) +
      Number(media.optionValueClientKey !== undefined);
    const variantRefCount =
      Number(media.variantId !== undefined) +
      Number(media.variantClientKey !== undefined);

    if (optionValueRefCount > 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Option-value media requires exactly one id or clientKey reference.',
        path: ['optionValueId'],
      });
    }
    if (variantRefCount > 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Variant media requires exactly one id or clientKey reference.',
        path: ['variantId'],
      });
    }
    if (optionValueRefCount > 0 && variantRefCount > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Media may have at most one option-value or variant scope.',
        path: ['optionValueId'],
      });
    }
  });

export const mediaWriteSchema = entityRefSchema.and(mediaFieldsSchema);

function uniqueUuidArray(label: string) {
  return z.array(uuidSchema).superRefine((ids, ctx) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      const identity = id.toLowerCase();
      if (seen.has(identity)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate ${label} retirement id ${id}.`,
          path: [index],
        });
      }
      seen.add(identity);
    });
  });
}

export const catalogGraphRetirementsSchema = z.object({
  optionIds: uniqueUuidArray('option').default([]),
  optionValueIds: uniqueUuidArray('option value').default([]),
  variantIds: uniqueUuidArray('variant').default([]),
  mediaIds: uniqueUuidArray('media').default([]),
});

const catalogGraphPatchShapeSchema = z.object({
  options: z.array(optionWriteSchema).default([]),
  variants: z.array(variantWriteSchema).max(100).default([]),
  media: z.array(mediaWriteSchema).default([]),
  retirements: catalogGraphRetirementsSchema.default(() => ({
    optionIds: [],
    optionValueIds: [],
    variantIds: [],
    mediaIds: [],
  })),
  // undefined = leave unchanged, EntityRef = set, null = clear.
  defaultDisplayVariant: entityRefSchema.nullable().optional(),
});

export const catalogGraphPatchSchema = catalogGraphPatchShapeSchema.superRefine(
  (patch, ctx) => {
    validateDefinedRowRefs(patch, ctx);
    validateClientKeyReferences(patch, ctx);
    validateOptionGraph(patch.options, ctx);
    validateVariants(patch.variants, ctx);
  },
);

function validateDefinedRowRefs(
  patch: z.infer<typeof catalogGraphPatchShapeSchema>,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  const rows: Array<{ ref: EntityRef; path: (string | number)[] }> = [];

  patch.options.forEach((option, optionIndex) => {
    rows.push({ ref: option, path: ['options', optionIndex] });
    option.values.forEach((optionValue, valueIndex) => {
      rows.push({
        ref: optionValue,
        path: ['options', optionIndex, 'values', valueIndex],
      });
    });
  });
  patch.variants.forEach((variant, index) => {
    rows.push({ ref: variant, path: ['variants', index] });
  });
  patch.media.forEach((media, index) => {
    rows.push({ ref: media, path: ['media', index] });
  });

  for (const { ref, path } of rows) {
    const key = entityRefKey(ref);
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate catalog row reference ${key}.`,
        path,
      });
    }
    seen.add(key);
  }
}

function validateClientKeyReferences(
  patch: z.infer<typeof catalogGraphPatchShapeSchema>,
  ctx: z.RefinementCtx,
): void {
  const optionValueClientKeys = new Set<string>();
  patch.options.forEach((option) => {
    option.values.forEach((optionValue) => {
      if ('clientKey' in optionValue && optionValue.clientKey !== undefined) {
        optionValueClientKeys.add(optionValue.clientKey);
      }
    });
  });

  const variantClientKeys = new Set<string>();
  patch.variants.forEach((variant) => {
    if ('clientKey' in variant && variant.clientKey !== undefined) {
      variantClientKeys.add(variant.clientKey);
    }
  });

  patch.variants.forEach((variant, variantIndex) => {
    variant.optionValueRefs.forEach((ref, refIndex) => {
      if (
        'clientKey' in ref &&
        ref.clientKey !== undefined &&
        !optionValueClientKeys.has(ref.clientKey)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown option value clientKey ${ref.clientKey}.`,
          path: ['variants', variantIndex, 'optionValueRefs', refIndex],
        });
      }
    });
  });

  patch.media.forEach((media, mediaIndex) => {
    if (
      media.optionValueClientKey !== undefined &&
      !optionValueClientKeys.has(media.optionValueClientKey)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Unknown option value clientKey ${media.optionValueClientKey}.`,
        path: ['media', mediaIndex, 'optionValueClientKey'],
      });
    }
    if (
      media.variantClientKey !== undefined &&
      !variantClientKeys.has(media.variantClientKey)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Unknown variant clientKey ${media.variantClientKey}.`,
        path: ['media', mediaIndex, 'variantClientKey'],
      });
    }
  });

  const defaultDisplayVariant = patch.defaultDisplayVariant;
  if (
    defaultDisplayVariant &&
    'clientKey' in defaultDisplayVariant &&
    defaultDisplayVariant.clientKey !== undefined &&
    !variantClientKeys.has(defaultDisplayVariant.clientKey)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `Unknown variant clientKey ${defaultDisplayVariant.clientKey}.`,
      path: ['defaultDisplayVariant', 'clientKey'],
    });
  }
}

function validateOptionGraph(
  options: z.infer<typeof optionWriteSchema>[],
  ctx: z.RefinementCtx,
): void {
  try {
    validateCatalogGraph({
      options: options.map((option) => ({
        id: entityRefKey(option),
        name: option.name,
        position: option.position,
        isActive: option.isActive,
        isMediaDriver: option.isMediaDriver,
        values: option.values.map((optionValue) => ({
          id: entityRefKey(optionValue),
          label: optionValue.label,
          isActive: optionValue.isActive,
        })),
      })),
    });
  } catch (error) {
    if (!(error instanceof CatalogGraphValidationError)) throw error;
    ctx.addIssue({
      code: 'custom',
      message: error.message,
      path: ['options'],
    });
  }

  options.forEach((option, optionIndex) => {
    const activePositions = new Set<number>();
    const activeLabels = new Set<string>();
    option.values.forEach((optionValue, valueIndex) => {
      if (!optionValue.isActive) return;

      if (activePositions.has(optionValue.position)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate active value position ${optionValue.position} in option ${option.name}.`,
          path: ['options', optionIndex, 'values', valueIndex, 'position'],
        });
      }
      activePositions.add(optionValue.position);

      const label = optionValue.label.trim().toLowerCase();
      if (activeLabels.has(label)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate active value label ${optionValue.label} in option ${option.name}.`,
          path: ['options', optionIndex, 'values', valueIndex, 'label'],
        });
      }
      activeLabels.add(label);
    });
  });
}

function validateVariants(
  variants: z.infer<typeof variantWriteSchema>[],
  ctx: z.RefinementCtx,
): void {
  validateUniqueNumbers(
    variants.map(({ position }) => position),
    'variant position',
    ['variants'],
    ctx,
  );

  const skuCodes = new Set<string>();
  variants.forEach((variant, variantIndex) => {
    const optionValueRefs = new Set<string>();
    variant.optionValueRefs.forEach((ref, refIndex) => {
      const key = entityRefKey(ref);
      if (optionValueRefs.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate option value reference ${key}.`,
          path: ['variants', variantIndex, 'optionValueRefs', refIndex],
        });
      }
      optionValueRefs.add(key);
    });

    if (!variant.sku) return;
    const skuCode = variant.sku.skuCode.trim().toLowerCase();
    if (skuCodes.has(skuCode)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate SKU code ${variant.sku.skuCode}.`,
        path: ['variants', variantIndex, 'sku', 'skuCode'],
      });
    }
    skuCodes.add(skuCode);
  });
}

function validateUniqueNumbers(
  values: number[],
  label: string,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<number>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate ${label} ${value}.`,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

function entityRefKey(ref: EntityRef): string {
  return 'id' in ref && ref.id !== undefined
    ? `id:${ref.id.toLowerCase()}`
    : `clientKey:${ref.clientKey}`;
}

export class CatalogGraphVersionRequiredError extends Error {
  readonly code = 'CATALOG_GRAPH_VERSION_REQUIRED';

  constructor() {
    super('catalogGraphVersion is required for catalog graph writes.');
    this.name = 'CatalogGraphVersionRequiredError';
  }
}

export class CatalogGraphVersionMismatchError extends Error {
  readonly code = 'CATALOG_GRAPH_VERSION_MISMATCH';

  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Catalog graph version ${expectedVersion} does not match current version ${actualVersion}.`,
    );
    this.name = 'CatalogGraphVersionMismatchError';
  }
}

export type OptionValueWrite = z.infer<typeof optionValueWriteSchema>;
export type OptionWrite = z.infer<typeof optionWriteSchema>;
export type SkuWrite = z.infer<typeof skuWriteSchema>;
export type VariantWrite = z.infer<typeof variantWriteSchema>;
export type MediaWrite = z.infer<typeof mediaWriteSchema>;
export type CatalogGraphRetirements = z.infer<
  typeof catalogGraphRetirementsSchema
>;
export type CatalogGraphPatch = z.infer<typeof catalogGraphPatchSchema>;
