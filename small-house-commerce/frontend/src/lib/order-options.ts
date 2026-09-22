/**
 * Display of an order line's authoritative option snapshot (plan Task 18).
 *
 * Every order line freezes the option identities and display names it was
 * sold with into `OrderItem.optionSnapshot` (backend
 * `modules/orders/order-item-snapshot.ts`); the legacy `variantSnapshot`
 * text stays populated for lines created before the typed option graph.
 * This module mirrors the backend snapshot shape (the frontend does not
 * import backend code) and renders either source: the structured snapshot
 * when present, the historical text otherwise. Snapshots are read
 * verbatim — never rebuilt, never re-sorted, never re-labelled.
 */

/** Mirrors backend `OrderOptionEntryV1`. */
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

/** Mirrors backend `OrderOptionSnapshotV1` — the whole stored JSON document. */
export type OrderOptionSnapshotV1 = {
  version: 1;
  options: OrderOptionEntryV1[];
};

/** One display pair. Historical fallback entries carry an empty label. */
export interface FormattedOrderOption {
  label: string;
  value: string;
}

/**
 * Renders one order line's options: the structured order-time snapshot when
 * it is usable, otherwise the legacy variant text as a single unlabeled
 * entry; no entries when neither exists.
 */
export function formatOrderOptions(
  optionSnapshot: OrderOptionSnapshotV1 | null,
  variantSnapshot: string | null,
): readonly FormattedOrderOption[] {
  if (
    optionSnapshot &&
    typeof optionSnapshot === "object" &&
    optionSnapshot.version === 1 &&
    Array.isArray(optionSnapshot.options) &&
    optionSnapshot.options.length > 0
  ) {
    return optionSnapshot.options.map((entry) => ({
      label: entry.label,
      value: entry.value,
    }));
  }
  // The stored JSON is read across a DB boundary: an unrecognized future
  // version falls back to the legacy text instead of guessing at its shape.
  const legacy = typeof variantSnapshot === "string" ? variantSnapshot.trim() : "";
  return legacy === "" ? [] : [{ label: "", value: legacy }];
}

/**
 * "Color: Red · Size: Small"; an unlabeled (historical fallback) entry
 * renders bare, and no entries render as an empty string.
 */
export function formatOrderOptionsText(
  options: readonly FormattedOrderOption[],
): string {
  return options
    .map((option) =>
      option.label === "" ? option.value : `${option.label}: ${option.value}`,
    )
    .join(" · ");
}

/** Convenience for the historical surfaces: one-line text straight from the stored snapshots. */
export function formatOrderOptionsFromSnapshot(
  optionSnapshot: OrderOptionSnapshotV1 | null,
  variantSnapshot: string | null,
): string {
  return formatOrderOptionsText(formatOrderOptions(optionSnapshot, variantSnapshot));
}
