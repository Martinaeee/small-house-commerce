import { z } from 'zod';

export const adCostInputSchema = z.object({
  linkId: z.string().uuid(),
  costDate: z.iso.date(),
  amountUsd: z.string().trim().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/),
  phpPerUsd: z.string().trim().regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();
export type AdCostInput = z.infer<typeof adCostInputSchema>;

export const adCostVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
export const adCostQuerySchema = z.object({
  ownerUserId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  landingPageId: z.string().uuid().optional(),
  linkId: z.string().uuid().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  includeVoided: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, { message: 'Start date must not follow end date.' });
export type AdCostQuery = z.infer<typeof adCostQuerySchema>;
