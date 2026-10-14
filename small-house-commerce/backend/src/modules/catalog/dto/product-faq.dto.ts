import { z } from 'zod';
import { FAQ_MODES } from '../faq/faq-content.js';

export const adminFaqProductQuerySchema = z.object({
  search: z.string().max(255).optional(),
  mode: z.enum(FAQ_MODES).optional(),
  productId: z.string().uuid().optional(),
  updatedSince: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminFaqProductQuery = z.infer<typeof adminFaqProductQuerySchema>;
