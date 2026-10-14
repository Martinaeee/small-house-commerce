import { z } from 'zod';
import { faqItemsSchema } from '../faq-content.js';

/**
 * Full-library replace with an optimistic lock. `expectedVersion` is required:
 * two administrators editing the shared library must not silently overwrite
 * each other.
 */
export const updateSharedFaqSchema = z.object({
  items: faqItemsSchema,
  expectedVersion: z.number().int().min(0),
});
export type UpdateSharedFaqInput = z.infer<typeof updateSharedFaqSchema>;

export interface SharedFaqImpactView {
  productCount: number;
  version: number;
}

/** FAQ-only product identity lookup; never exposes the full product admin API. */
export const sharedFaqProductQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  ids: z.preprocess(
    (value) => typeof value === 'string'
      ? value.split(',').map((id) => id.trim()).filter(Boolean)
      : value,
    z.array(z.string().uuid()).min(1).max(100),
  ).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SharedFaqProductQuery = z.infer<typeof sharedFaqProductQuerySchema>;
