import { z } from 'zod';

export const inventoryAdjustSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().max(255).nullable().optional(),
});

export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>;
