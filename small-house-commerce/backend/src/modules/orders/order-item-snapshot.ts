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

/** One component of a Bundle line as stored at order time. */
export type OrderBundleComponentV1 = {
  /** Stable component SKU identity — survives renames and redefinitions. */
  componentSkuId: string;
  skuCode: string;
  productName: string;
  variantName: string;
  /** Units of this component per one Bundle. */
  quantity: number;
  /** Units across the whole line (per-Bundle quantity × line quantity). */
  totalQuantity: number;
  position: number;
};

/**
 * Versioned structured snapshot stored in `OrderItem.bundleSnapshot` for
 * virtual Bundle lines. The physical components an order owes are frozen here
 * at order time; a later definition change never rewrites history.
 */
export type OrderBundleSnapshotV1 = {
  version: 1;
  bundleSkuId: string;
  bundleSkuCode: string;
  components: OrderBundleComponentV1[];
};

/** One component binding as loaded from the current definition at order time. */
export type BundleSnapshotComponentInput = {
  componentSkuId: string;
  quantity: number;
  position: number;
  componentSku: {
    skuCode: string;
    variant: { name: string; product: { name: string } };
  };
};

/**
 * Builds the Bundle snapshot for one order line: components in definition
 * position order, identities and display names captured verbatim, and the
 * per-line totals derived from the ordered line quantity.
 */
export function buildBundleSnapshot(input: {
  skuId: string;
  skuCode: string;
  quantity: number;
  components: readonly BundleSnapshotComponentInput[];
}): OrderBundleSnapshotV1 {
  const components = [...input.components]
    .sort(
      (left, right) =>
        left.position - right.position ||
        left.componentSkuId.localeCompare(right.componentSkuId),
    )
    .map((component) => ({
      componentSkuId: component.componentSkuId,
      skuCode: component.componentSku.skuCode,
      productName: component.componentSku.variant.product.name,
      variantName: component.componentSku.variant.name,
      quantity: component.quantity,
      totalQuantity: component.quantity * input.quantity,
      position: component.position,
    }));

  return {
    version: 1,
    bundleSkuId: input.skuId,
    bundleSkuCode: input.skuCode,
    components,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isWholeNumberAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

/**
 * Reads a stored Bundle snapshot, or null when it is missing or malformed.
 * Every read of historical order data goes through here: an unreadable
 * snapshot must fail closed rather than silently demand nothing.
 */
export function readBundleSnapshot(value: unknown): OrderBundleSnapshotV1 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (!isNonEmptyString(candidate.bundleSkuId) || !isNonEmptyString(candidate.bundleSkuCode)) return null;
  if (!Array.isArray(candidate.components) || candidate.components.length === 0 || candidate.components.length > 20) return null;

  const identities = new Set<string>();
  let lineQuantity: number | undefined;
  const components: OrderBundleComponentV1[] = [];
  for (const raw of candidate.components) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const component = raw as Record<string, unknown>;
    if (
      !isNonEmptyString(component.componentSkuId) ||
      !isNonEmptyString(component.skuCode) ||
      !isNonEmptyString(component.productName) ||
      !isNonEmptyString(component.variantName) ||
      !isWholeNumberAtLeast(component.quantity, 1) || component.quantity > 1000 ||
      !isWholeNumberAtLeast(component.totalQuantity, 1) ||
      !isWholeNumberAtLeast(component.position, 0)
    ) {
      return null;
    }
    const quantity = component.totalQuantity / component.quantity;
    if (
      component.componentSkuId === candidate.bundleSkuId ||
      identities.has(component.componentSkuId) ||
      !Number.isSafeInteger(quantity) ||
      (lineQuantity !== undefined && lineQuantity !== quantity)
    ) return null;
    identities.add(component.componentSkuId);
    lineQuantity = quantity;
    components.push({
      componentSkuId: component.componentSkuId,
      skuCode: component.skuCode,
      productName: component.productName,
      variantName: component.variantName,
      quantity: component.quantity,
      totalQuantity: component.totalQuantity,
      position: component.position,
    });
  }

  return {
    version: 1,
    bundleSkuId: candidate.bundleSkuId,
    bundleSkuCode: candidate.bundleSkuCode,
    components,
  };
}

/**
 * Whether two stored snapshots describe the same physical definition: the
 * component identities and per-Bundle quantities, never display labels or the
 * per-line totals (which follow the line quantity, not the definition).
 * Unreadable values never match anything, including each other.
 */
export function sameBundleSnapshot(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true;
  const a = readBundleSnapshot(left);
  const b = readBundleSnapshot(right);
  if (a === null || b === null) return false;
  if (a.bundleSkuId !== b.bundleSkuId || a.components.length !== b.components.length) return false;
  return a.components.every((component, index) => {
    const other = b.components[index]!;
    return component.componentSkuId === other.componentSkuId && component.quantity === other.quantity;
  });
}
