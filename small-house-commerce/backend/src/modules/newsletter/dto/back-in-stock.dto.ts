import { z } from 'zod';

export const backInStockSubscribeSchema = z.object({
  email: z.string().trim().email().max(200),
  skuId: z.string().uuid(),
  // Optional contact number for follow-up. The alert itself is still email
  // only; the number is stored with the subscription so the shop can reach
  // the shopper (call / WhatsApp) when the item returns.
  phone: z.string().trim().max(32).optional(),
});

export const backInStockQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'SENT', 'CANCELLED']).optional(),
});

export const backInStockUnsubscribeQuerySchema = z.object({
  token: z.string().min(1).max(2_048),
});

export type BackInStockSubscribeInput = z.infer<
  typeof backInStockSubscribeSchema
>;
export type BackInStockQuery = z.infer<typeof backInStockQuerySchema>;
export type BackInStockUnsubscribeQuery = z.infer<
  typeof backInStockUnsubscribeQuerySchema
>;
