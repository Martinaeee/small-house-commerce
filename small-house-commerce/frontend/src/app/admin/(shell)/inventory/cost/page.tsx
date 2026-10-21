"use client";

import { CostBackfillTable } from "@/components/admin/inventory/CostBackfillTable";

/**
 * `/admin/inventory/cost` — the cost backfill grid.
 *
 * A sub-route of the existing Inventory module (no new navigation entry):
 * it fills the landed cost of every SKU so the dashboard can publish a real
 * profit instead of withholding it.
 */
export default function InventoryCostPage() {
  return <CostBackfillTable />;
}
