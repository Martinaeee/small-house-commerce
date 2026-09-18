import { z } from 'zod';
import { siteMediaUrl } from '../../../common/site-media-url.js';
import { CategoryStatus } from '../../../generated/prisma/client.js';
import { heroStyleSchema } from './hero-style.dto.js';

/** Lowercase kebab-case, used for slugs on categories and products. */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case (e.g. folding-chair)');

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().default(0),
  imageUrl: siteMediaUrl().nullable().optional(),
  status: z.nativeEnum(CategoryStatus).default('ACTIVE'),
  // undefined = untouched, null = clear, object = upsert.
  heroStyle: heroStyleSchema.nullable().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
