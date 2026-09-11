import { z } from 'zod';
import { CollectionStatus, CollectionType } from '../../../generated/prisma/client.js';

export const createCollectionSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case'),
  type: z.nativeEnum(CollectionType).default('NAVIGATION'),
  description: z.string().max(1000).nullable().optional(),
  heroImage: z.string().url().max(2048).nullable().optional(),
  status: z.nativeEnum(CollectionStatus).default('ACTIVE'),
  sortOrder: z.number().int().default(0),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(400).nullable().optional(),
  productIds: z.array(z.string().uuid()).default([]),
});

export const updateCollectionSchema = createCollectionSchema.partial();

export const collectionQuerySchema = z.object({
  type: z.nativeEnum(CollectionType).optional(),
  status: z.nativeEnum(CollectionStatus).optional(),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const addProductsSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(50),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type CollectionQuery = z.infer<typeof collectionQuerySchema>;
