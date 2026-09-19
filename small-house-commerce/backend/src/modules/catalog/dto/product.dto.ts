import { z } from 'zod';
import { siteMediaUrl } from '../../../common/site-media-url.js';
import {
  DetailBlockType,
  InternalProductRole,
  ProductStatus,
  Room,
  SkuStatus,
  Solution,
} from '../../../generated/prisma/client.js';
import { slugSchema } from './category.dto.js';

const skuSchema = z.object({
  skuCode: z.string().min(1).max(64),
  status: z.nativeEnum(SkuStatus).default('ACTIVE'),
  supplierSku: z.string().max(120).optional(),
  supplierCost: z.number().nonnegative().optional(),
  costCurrency: z.string().max(8).optional(),
  landedCost: z.number().nonnegative().optional(),
  // Retail pricing in PHP; compareAtPrice is the strikethrough original price.
  price: z.number().nonnegative().optional(),
  compareAtPrice: z.number().nonnegative().optional(),
  productWeight: z.number().nonnegative().optional(),
  packageWidth: z.number().nonnegative().optional(),
  packageHeight: z.number().nonnegative().optional(),
  packageDepth: z.number().nonnegative().optional(),
  packageWeight: z.number().nonnegative().optional(),
  volumetricWeight: z.number().nonnegative().optional(),
});

const variantSchema = z.object({
  name: z.string().min(1).max(120),
  position: z.number().int().default(0),
  // A variant may exist without a SKU yet; the SKU is what makes it sellable.
  sku: skuSchema.optional(),
});

const imageSchema = z.object({
  url: siteMediaUrl(),
  altText: z.string().max(255).optional(),
  sortOrder: z.number().int().default(0),
});

/**
 * One block of the PDP description body. Media-only on purpose: the supplier
 * detail decks are images/videos, and `description` already carries the short
 * text intro.
 */
const detailBlockSchema = z.object({
  type: z.nativeEnum(DetailBlockType),
  url: siteMediaUrl(),
  altText: z.string().max(255).optional(),
  sortOrder: z.number().int().default(0),
});

/**
 * Base product shape. Create requires it; update is a partial of it, with
 * images and variants treated as full replacements when present (the admin
 * form submits the whole list).
 */
const productBaseSchema = z.object({
  name: z.string().min(1).max(255),
  slug: slugSchema,
  description: z.string().max(5000).nullable().optional(),
  // First-screen one-line selling point under the H1; null/'' hides the row.
  tagline: z.string().max(200).nullable().optional(),
  categoryId: z.string().uuid(),
  status: z.nativeEnum(ProductStatus).default('DRAFT'),
  room: z.nativeEnum(Room).nullable().optional(),
  internalRole: z.nativeEnum(InternalProductRole).nullable().optional(),
  solutions: z.array(z.nativeEnum(Solution)).default([]),
  width: z.number().nonnegative().nullable().optional(),
  height: z.number().nonnegative().nullable().optional(),
  depth: z.number().nonnegative().nullable().optional(),
  foldedWidth: z.number().nonnegative().nullable().optional(),
  foldedHeight: z.number().nonnegative().nullable().optional(),
  foldedDepth: z.number().nonnegative().nullable().optional(),
  // Structured specifications; features is one entry per line.
  materials: z.string().max(1000).nullable().optional(),
  features: z.string().max(2000).nullable().optional(),
  images: z.array(imageSchema).default([]),
  detailBlocks: z.array(detailBlockSchema).default([]),
  variants: z.array(variantSchema).default([]),
});

export const createProductSchema = productBaseSchema;

/**
 * Update is a partial, but fields with a create-side default (status DRAFT,
 * solutions [], variants/images []) must NOT keep their defaults here:
 * partial() preserves them, so a PATCH omitting those fields would silently
 * reset them — status flips products back to DRAFT (hiding them from the
 * storefront), solutions clears the merchandising attributes, and
 * variants/images get wiped (their SKUs are FK-restricted by
 * inventory/orders -> P2003). Optional + undefined means "leave untouched".
 */
export const updateProductSchema = productBaseSchema
  .omit({ variants: true, images: true, detailBlocks: true, status: true, solutions: true })
  .partial()
  .extend({
    variants: z.array(variantSchema).optional(),
    images: z.array(imageSchema).optional(),
    detailBlocks: z.array(detailBlockSchema).optional(),
    status: z.nativeEnum(ProductStatus).optional(),
    solutions: z.array(z.nativeEnum(Solution)).optional(),
  });

export const adminProductQuerySchema = z.object({
  search: z.string().max(255).optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Storefront queries force ACTIVE and must never expose cost data. */
export const storefrontProductQuerySchema = z.object({
  search: z.string().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  room: z.nativeEnum(Room).optional(),
  solution: z.nativeEnum(Solution).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  // Homepage "Recently Viewed": ordered id batch lookup (max 12).
  ids: z
    .preprocess(
      (value) =>
        typeof value === 'string'
          ? value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          : value,
      z.array(z.string().uuid()).max(12),
    )
    .optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;
export type StorefrontProductQuery = z.infer<typeof storefrontProductQuerySchema>;
