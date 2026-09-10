import { z } from 'zod';
import {
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
  url: z.string().url().max(2048),
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
  images: z.array(imageSchema).default([]),
  variants: z.array(variantSchema).default([]),
});

export const createProductSchema = productBaseSchema;
export const updateProductSchema = productBaseSchema.partial();

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
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;
export type StorefrontProductQuery = z.infer<typeof storefrontProductQuerySchema>;
