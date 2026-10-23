import { z } from 'zod';

export const handoverItemSchema = z.object({
  orderItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

export const recordHandoverSchema = z.object({
  type: z.enum(['HANDED_OVER', 'REJECTED', 'WITHDRAWN']),
  occurredAt: z.coerce.date().nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  items: z.array(handoverItemSchema).min(1).max(50),
});

export type RecordHandoverInput = z.infer<typeof recordHandoverSchema>;
