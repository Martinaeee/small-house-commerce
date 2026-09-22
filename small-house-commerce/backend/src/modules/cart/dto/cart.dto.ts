import { z } from 'zod';

export const addItemSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).default(1),
  // Optional: the guest client sends its stored cart id on subsequent adds.
  cartId: z.string().uuid().optional(),
});

export const updateItemQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(99),
});

// "Change options" on a cart line: swap the line to another combination of
// the same product. The service rejects cross-product SKUs.
export const replaceItemSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

export type AddItemInput = z.infer<typeof addItemSchema>;
export type UpdateItemQuantityInput = z.infer<typeof updateItemQuantitySchema>;
export type ReplaceItemInput = z.infer<typeof replaceItemSchema>;
