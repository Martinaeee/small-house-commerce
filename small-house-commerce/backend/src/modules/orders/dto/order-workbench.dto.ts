import { z } from 'zod';
import { checkoutSchema } from './order.dto.js';

export const convertCheckoutDraftSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    riskReviewed: z.boolean().default(false),
    customer: checkoutSchema.shape.customer.optional(),
    preferredDeliveryDate: checkoutSchema.shape.preferredDeliveryDate,
    customerNote: checkoutSchema.shape.customerNote.optional(),
  })
  .strict();

export type ConvertCheckoutDraftInput = z.infer<
  typeof convertCheckoutDraftSchema
>;

const ids = z
  .array(z.string().uuid())
  .min(1)
  .max(100)
  .refine(
    (value) => new Set(value).size === value.length,
    'Select each order only once',
  );
export const bulkOrdersSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), ids }).strict(),
  z.object({ action: z.literal('cancel'), ids }).strict(),
  z
    .object({
      action: z.literal('assign'),
      ids,
      assignedToId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal('status'),
      ids,
      status: z.enum([
        'PENDING',
        'QUESTION',
        'ABNORMAL',
        'DENIED',
        'AFTER_SALES',
      ]),
      comment: z.string().trim().max(500).optional(),
    })
    .strict(),
]);
export type BulkOrdersInput = z.infer<typeof bulkOrdersSchema>;
