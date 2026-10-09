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
