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

/**
 * One SKU's cost in a backfill batch.
 *
 * `null` clears a value (an unknown cost has to be able to go back to
 * unknown); omitting a field leaves it untouched. Costs are plain numbers
 * here — unlike the raw-Prisma admin endpoints, this endpoint answers with
 * numbers because it is a purpose-built grid.
 */
export const inventoryCostItemSchema = z.object({
  skuId: z.string().uuid(),
  landedCost: z.number().nonnegative().nullable().optional(),
  supplierCost: z.number().nonnegative().nullable().optional(),
  costCurrency: z.string().max(8).nullable().optional(),
});

export const inventoryCostBatchSchema = z.object({
  items: z
    .array(inventoryCostItemSchema)
    .min(1, 'At least one SKU is required')
    .max(200, 'At most 200 SKUs can be updated in one batch'),
});

export type InventoryCostItemInput = z.infer<typeof inventoryCostItemSchema>;
export type InventoryCostBatchInput = z.infer<typeof inventoryCostBatchSchema>;
