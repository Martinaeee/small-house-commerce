import { z } from 'zod';

export const inventoryAdjustSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().max(255).nullable().optional(),
});

export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>;

/**
 * Absolute set used by the product form: the admin types the stock level they
 * want. The service turns it into the same MANUAL_ADJUSTMENT movement the
 * delta endpoint writes, so no audit history is lost.
 */
export const inventorySetStockSchema = z.object({
  skuId: z.string().uuid(),
  onHand: z.number().int().min(0).max(1_000_000),
  reason: z.string().max(255).nullable().optional(),
});

export type InventorySetStockInput = z.infer<typeof inventorySetStockSchema>;
