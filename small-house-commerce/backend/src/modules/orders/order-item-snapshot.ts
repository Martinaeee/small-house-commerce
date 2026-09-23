/**
 * Authoritative order-time snapshots for order lines (plan Task 17).
 *
 * Order history must survive later option renames: every NEW order line
 * freezes the option identities and display names it was sold with into
 * `OrderItem.optionSnapshot`, while the legacy `variantSnapshot` text keeps
 * pre-existing readers and legacy products working. Snapshots are written
 * exactly once at creation (storefront checkout and admin manual entry both
 * go through OrdersService.checkout; admin order edit adds lines through the
 * same builder) and are never rebuilt at read time.
 *
 * Declared as type aliases, not interfaces: implicit index signatures keep
 * the shapes assignable to Prisma's `InputJsonValue` at the write sites.
 */

/** One typed option entry of an order line, frozen at order time. */
export type OrderOptionEntryV1 = {
  /** Stable option identity — survives renames and display reordering. */
  optionId: string;
  /** Stable option-value identity — survives renames. */
  optionValueId: string;
  /** Option display name as of order time (e.g. "Color"). */
  label: string;
  /** Chosen value display name as of order time (e.g. "Red"). */
  value: string;
};

/**
 * Versioned structured snapshot stored in `OrderItem.optionSnapshot` — the
 * whole JSON document, named to match the plan contract (Task 18 consumes
 * `OrderOptionSnapshotV1 | null` directly).
 */
export type OrderOptionSnapshotV1 = {
  version: 1;
  options: OrderOptionEntryV1[];
};

/** The write shape applied to every new `OrderItem` row. */
export type OrderItemSnapshotWrite = {
  /** Legacy free-text variant name; still populated for historical fallback. */
  variantSnapshot: string;
  /**
   * Structured order-time snapshot; null when the variant has no typed
   * option graph (legacy products) — readers fall back to `variantSnapshot`.
   */
  optionSnapshot: OrderOptionSnapshotV1 | null;
};

/** Minimal structural shape of a SKU loaded with variant + option graph. */
export type SkuWithVariantProductAndOptionAssignments = {
  variant: {
    name: string;
    optionValues?:
      | readonly {
          optionId: string;
          optionValueId: string;
          option: { name: string; position: number };
          optionValue: { label: string };
        }[]
      | null;
  };
};

/**
 * Builds the write shape for one order line from the SKU as loaded at
 * checkout: options sorted by their option group's position (stable optionId
 * tie-break), identities and display names captured verbatim.
 */
export function buildOrderItemSnapshot(
  sku: SkuWithVariantProductAndOptionAssignments,
): OrderItemSnapshotWrite {
  const assignments = sku.variant.optionValues ?? [];
  const options: OrderOptionEntryV1[] = assignments
    .map((assignment, index) => ({
      assignment,
      index,
    }))
    .sort(
      (left, right) =>
        // Option display position governs; the stable id (then the original
        // array order) keeps the sort total and deterministic on ties.
        left.assignment.option.position - right.assignment.option.position ||
        left.assignment.optionId.localeCompare(right.assignment.optionId) ||
        left.index - right.index,
    )
    .map(({ assignment }) => ({
      optionId: assignment.optionId,
      optionValueId: assignment.optionValueId,
      label: assignment.option.name,
      value: assignment.optionValue.label,
    }));

  return {
    variantSnapshot: sku.variant.name,
    // null (not an empty list) marks "no structured options captured" so
    // readers fall back to the legacy variant text.
    optionSnapshot: options.length > 0 ? { version: 1, options } : null,
  };
}
