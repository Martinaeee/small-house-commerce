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

/**
 * Bounded batch of absolute sets for the product form's two-phase save. The
 * cap is 100 entries — the same maximum number of variants a product may have
 * (ten chunks of ten) — so one request can never turn into an unbounded burst
 * of ledger movements. Each entry is validated with the single-set-stock
 * shape; duplicate skuIds are legal and applied in array order by the service.
 */
export const inventoryBatchSetStockSchema = z
  .array(inventorySetStockSchema)
  .min(1, 'At least one SKU is required')
  .max(100, 'At most 100 SKUs can be updated in one batch');

export type InventoryBatchSetStockInput = z.infer<typeof inventoryBatchSetStockSchema>;
