export interface CatalogOptionValueDraft {
  id: string;
  label: string;
  isActive?: boolean;
}

export interface CatalogOptionDraft {
  id: string;
  name: string;
  position: number;
  values: readonly CatalogOptionValueDraft[];
  isActive?: boolean;
  isMediaDriver?: boolean;
}

export interface CatalogGraphDraft {
  options: readonly CatalogOptionDraft[];
}

export interface CandidateGroup {
  name: string;
  activeValueCount: number;
}

export interface CatalogGraphValidationResult {
  activeOptionCount: number;
  candidateCount: number;
  combinationKeys: string[];
}

export interface ExistingVariantForReconciliation {
  id: string;
  combinationKey: string;
  hasHistory: boolean;
}

export interface VariantReconciliationPlan {
  retain: ExistingVariantForReconciliation[];
  create: string[];
  disable: ExistingVariantForReconciliation[];
  delete: ExistingVariantForReconciliation[];
}

export interface VariantReconciliationInput {
  existingVariants: readonly ExistingVariantForReconciliation[];
  desiredCombinationKeys: readonly (string | { combinationKey: string })[];
}

export class CatalogGraphValidationError extends Error {
  readonly code = "CATALOG_GRAPH_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CatalogGraphValidationError";
  }
}

/**
 * Returns a stable identity for a set of option/value pairs.
 *
 * Display order is intentionally not part of this identity. Sorting the
 * already-rendered `optionId:valueId` strings also keeps the implementation
 * independent from the order in which options were supplied.
 */
export function canonicalCombinationKey(
  pairs: readonly { optionId: string; valueId: string }[],
): string {
  return pairs
    .map(({ optionId, valueId }) => ({
      raw: `${optionId}:${valueId}`,
      encoded: `${encodeURIComponent(optionId)}:${encodeURIComponent(valueId)}`,
    }))
    .sort(
      (left, right) =>
        left.raw.localeCompare(right.raw) ||
        left.encoded.localeCompare(right.encoded),
    )
    .map(({ encoded }) => encoded)
    .join("|");
}

/** Builds the human-readable variant name in option display order. */
export function deriveVariantName(
  values: readonly { optionPosition: number; valueLabel: string }[],
): string {
  return [...values]
    .sort((left, right) => left.optionPosition - right.optionPosition)
    .map(({ valueLabel }) => valueLabel)
    .join(" / ");
}

/**
 * Counts the Cartesian candidates for the active option groups.
 *
 * An empty product has one candidate: the empty combination. This is the
 * graph used by products that have no active option groups.
 */
export function countCandidateCombinations(
  groups: readonly CandidateGroup[],
): number {
  if (groups.length > 2) {
    throw new CatalogGraphValidationError(
      `A catalog graph may have at most two active option groups; received ${groups.length}.`,
    );
  }

  let count = 1;
  for (const group of groups) {
    if (!group.name.trim()) {
      throw new CatalogGraphValidationError(
        "Every active option group must have a name.",
      );
    }
    if (!Number.isInteger(group.activeValueCount) || group.activeValueCount < 1) {
      throw new CatalogGraphValidationError(
        `Option ${group.name} must have at least one active value.`,
      );
    }

    count *= group.activeValueCount;
    if (count > 100) {
      throw new CatalogGraphValidationError(
        `Active option groups ${groups.map(({ name }) => name).join(" and ")} produce ${count} candidates; the limit is 100.`,
      );
    }
  }

  return count;
}

/**
 * Validates the pure, typed portion of a catalog graph and returns the
 * candidate identities that the persistence layer can reconcile.
 */
export function validateCatalogGraph(
  graph: CatalogGraphDraft | readonly CatalogOptionDraft[],
): CatalogGraphValidationResult {
  const options: readonly CatalogOptionDraft[] = Array.isArray(graph)
    ? (graph as readonly CatalogOptionDraft[])
    : (graph as CatalogGraphDraft).options;
  const activeOptionDrafts = options.filter(
    ({ isActive }: CatalogOptionDraft) => isActive !== false,
  );
  if (activeOptionDrafts.length > 2) {
    throw new CatalogGraphValidationError(
      `A catalog graph may have at most two active option groups; received ${activeOptionDrafts.length}.`,
    );
  }
  const optionIds = new Set<string>();
  const valueIds = new Set<string>();
  const activeOptions: CatalogOptionDraft[] = [];
  const activeOptionNames = new Set<string>();
  const activePositions = new Set<number>();
  let mediaDriverCount = 0;

  for (const option of options) {
    assertNonEmpty(option.id, "Option id");
    assertNonEmpty(option.name, `Option ${option.id} name`);
    if (optionIds.has(option.id)) {
      throw new CatalogGraphValidationError(
        `Duplicate option id ${option.id}.`,
      );
    }
    optionIds.add(option.id);

    for (const value of option.values) {
      assertNonEmpty(value.id, `Value id in option ${option.name}`);
      assertNonEmpty(value.label, `Value ${value.id} label`);
      if (valueIds.has(value.id)) {
        throw new CatalogGraphValidationError(
          `Duplicate option value id ${value.id}.`,
        );
      }
      valueIds.add(value.id);
    }

    if (option.isActive === false) continue;

    const normalizedName = normalizeLabel(option.name);
    if (activeOptionNames.has(normalizedName)) {
      throw new CatalogGraphValidationError(
        `Duplicate active option label ${option.name}.`,
      );
    }
    activeOptionNames.add(normalizedName);

    if (!Number.isInteger(option.position) || option.position < 0 || option.position > 1) {
      throw new CatalogGraphValidationError(
        `Active option ${option.name} must use position 0 or 1.`,
      );
    }
    if (activePositions.has(option.position)) {
      throw new CatalogGraphValidationError(
        `Duplicate active option position ${option.position}.`,
      );
    }
    activePositions.add(option.position);

    const activeValues = option.values.filter(({ isActive }) => isActive !== false);
    if (activeValues.length === 0) {
      throw new CatalogGraphValidationError(
        `Active option ${option.name} must have at least one active value.`,
      );
    }
    if (activeValues.length > 100) {
      throw new CatalogGraphValidationError(
        `Option ${option.name} has ${activeValues.length} active values; the limit is 100.`,
      );
    }

    const valueLabels = new Set<string>();
    for (const value of activeValues) {
      const normalizedLabel = normalizeLabel(value.label);
      if (valueLabels.has(normalizedLabel)) {
        throw new CatalogGraphValidationError(
          `Duplicate active value label ${value.label} in option ${option.name}.`,
        );
      }
      valueLabels.add(normalizedLabel);
    }

    if (option.isMediaDriver) mediaDriverCount += 1;
    activeOptions.push(option);
  }

  if (activeOptions.length > 2) {
    throw new CatalogGraphValidationError(
      `A catalog graph may have at most two active option groups; received ${activeOptions.length}.`,
    );
  }
  if (mediaDriverCount > 1) {
    throw new CatalogGraphValidationError(
      "A catalog graph may have at most one active media-driver option group.",
    );
  }

  const candidateCount = countCandidateCombinations(
    activeOptions.map((option) => ({
      name: option.name,
      activeValueCount: option.values.filter(({ isActive }) => isActive !== false)
        .length,
    })),
  );

  const combinationKeys = buildCombinationKeys(activeOptions);
  return {
    activeOptionCount: activeOptions.length,
    candidateCount,
    combinationKeys,
  };
}

export function planVariantReconciliation(
  existingVariants: readonly ExistingVariantForReconciliation[],
  desiredCombinationKeys: readonly (string | { combinationKey: string })[],
): VariantReconciliationPlan;
export function planVariantReconciliation(
  input: VariantReconciliationInput,
): VariantReconciliationPlan;
export function planVariantReconciliation(
  existingOrInput:
    | readonly ExistingVariantForReconciliation[]
    | VariantReconciliationInput,
  desiredKeys?: readonly (string | { combinationKey: string })[],
): VariantReconciliationPlan {
  const isArrayInput = Array.isArray(existingOrInput);
  const existingVariants: readonly ExistingVariantForReconciliation[] = isArrayInput
    ? (existingOrInput as readonly ExistingVariantForReconciliation[])
    : (existingOrInput as VariantReconciliationInput).existingVariants;
  const desiredCombinationKeys: readonly (string | { combinationKey: string })[] =
    isArrayInput
      ? desiredKeys ?? []
      : (existingOrInput as VariantReconciliationInput).desiredCombinationKeys;

  const existingByKey = new Map<string, ExistingVariantForReconciliation>();
  const existingIds = new Set<string>();
  for (const variant of existingVariants) {
    assertNonEmpty(variant.id, "Variant id");
    if (existingIds.has(variant.id)) {
      throw new CatalogGraphValidationError(`Duplicate variant id ${variant.id}.`);
    }
    existingIds.add(variant.id);
    if (existingByKey.has(variant.combinationKey)) {
      throw new CatalogGraphValidationError(
        `Duplicate existing combination key ${variant.combinationKey}.`,
      );
    }
    existingByKey.set(variant.combinationKey, variant);
  }

  const desiredKeysInOrder = desiredCombinationKeys.map((entry) =>
    typeof entry === "string" ? entry : entry.combinationKey,
  );
  const desiredKeysSet = new Set<string>();
  for (const key of desiredKeysInOrder) {
    if (desiredKeysSet.has(key)) {
      throw new CatalogGraphValidationError(
        `Duplicate desired combination key ${key}.`,
      );
    }
    desiredKeysSet.add(key);
  }

  const retain: ExistingVariantForReconciliation[] = [];
  const disable: ExistingVariantForReconciliation[] = [];
  const remove: ExistingVariantForReconciliation[] = [];
  for (const variant of existingVariants) {
    if (desiredKeysSet.has(variant.combinationKey)) {
      retain.push(variant);
    } else if (variant.hasHistory) {
      disable.push(variant);
    } else {
      remove.push(variant);
    }
  }

  const create = desiredKeysInOrder.filter((key) => !existingByKey.has(key));
  return { retain, create, disable, delete: remove };
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new CatalogGraphValidationError(`${field} must not be empty.`);
  }
}

function buildCombinationKeys(
  options: readonly CatalogOptionDraft[],
): string[] {
  const positionedOptions = [...options].sort(
    (left, right) => left.position - right.position,
  );
  let combinations: { optionId: string; valueId: string }[][] = [[]];

  for (const option of positionedOptions) {
    const activeValues = option.values.filter(({ isActive }) => isActive !== false);
    combinations = combinations.flatMap((pairs) =>
      activeValues.map((value) => [
        ...pairs,
        { optionId: option.id, valueId: value.id },
      ]),
    );
  }

  return combinations.map((pairs) => canonicalCombinationKey(pairs));
}
