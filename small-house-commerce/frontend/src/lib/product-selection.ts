import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "./api";

export type SelectionSource =
  | "DEFAULT"
  | "DEEP_LINK"
  | "USER"
  | "CONFIRM_DIALOG";
export type SelectedValueIds = Readonly<Record<string, string>>;

export interface ProductSelectionState {
  selectedValueIds: SelectedValueIds;
  explicitlyTouchedOptionIds: readonly string[];
  selectionSource: SelectionSource;
  quantity: number;
  selectionRevision: number;
  confirmedCombinationKey: string | null;
  confirmedRevision: number | null;
}

export interface ProductSelectionDerived {
  resolvedVariant: StorefrontProductVariant | null;
  resolvedCombinationKey: string | null;
  displayVariant: StorefrontProductVariant | null;
  selectableVariants: StorefrontProductVariant[];
  purchasableVariant: StorefrontProductVariant | null;
  purchaseConfirmed: boolean;
  missingOptionIds: string[];
  price: number | null;
  compareAtPrice: number | null;
  availableInventory: number;
}

export type ProductSelectionAction =
  | { type: "SELECT_OPTION"; optionId: string; valueId: string }
  | { type: "CONFIRM" }
  | { type: "SET_QUANTITY"; quantity: number }
  | { type: "CHANGE_VARIANT" };

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

function comparePositionThenId(
  left: { id: string; position: number },
  right: { id: string; position: number },
): number {
  return (
    left.position - right.position ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function orderedOptions(
  options: readonly StorefrontProductOption[],
): StorefrontProductOption[] {
  return [...options].sort(comparePositionThenId);
}

function isSelectableVariant(variant: StorefrontProductVariant): boolean {
  return variant.sku?.status === "ACTIVE" && variant.sku.price !== null;
}

function selectableVariants(product: Product): StorefrontProductVariant[] {
  return product.variants.filter(isSelectableVariant);
}

function normalizeQuantity(quantity: number): number {
  if (Number.isNaN(quantity) || quantity === Number.NEGATIVE_INFINITY) {
    return MIN_QUANTITY;
  }
  if (quantity === Number.POSITIVE_INFINITY) return MAX_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, Math.trunc(quantity)));
}

/** Mirrors the backend canonicalCombinationKey implementation byte-for-byte. */
export function combinationKeyForSelection(
  options: readonly StorefrontProductOption[],
  selectedValueIds: SelectedValueIds,
): string | null {
  const pairs: Array<{ raw: string; encoded: string }> = [];

  for (const option of options) {
    const valueId = selectedValueIds[option.id];
    if (
      valueId === undefined ||
      !option.values.some((value) => value.id === valueId)
    ) {
      return null;
    }
    pairs.push({
      raw: `${option.id}:${valueId}`,
      encoded: `${encodeURIComponent(option.id)}:${encodeURIComponent(valueId)}`,
    });
  }

  return pairs
    .sort(
      (left, right) =>
        left.raw.localeCompare(right.raw) ||
        left.encoded.localeCompare(right.encoded),
    )
    .map(({ encoded }) => encoded)
    .join("|");
}

function parseCombinationKey(key: string): SelectedValueIds | null {
  if (key === "") return {};

  const selectedValueIds: Record<string, string> = {};
  for (const token of key.split("|")) {
    const separator = token.indexOf(":");
    if (separator < 0) return null;

    try {
      const optionId = decodeURIComponent(token.slice(0, separator));
      const valueId = decodeURIComponent(token.slice(separator + 1));
      if (!optionId || !valueId || selectedValueIds[optionId] !== undefined) {
        return null;
      }
      selectedValueIds[optionId] = valueId;
    } catch {
      return null;
    }
  }
  return selectedValueIds;
}

function selectionForVariant(
  product: Product,
  variant: StorefrontProductVariant,
): SelectedValueIds | null {
  const selectedValueIds = parseCombinationKey(variant.combinationKey);
  if (selectedValueIds === null) return null;

  const optionIds = new Set(product.options.map(({ id }) => id));
  if (
    Object.keys(selectedValueIds).length !== product.options.length ||
    Object.keys(selectedValueIds).some((optionId) => !optionIds.has(optionId)) ||
    combinationKeyForSelection(product.options, selectedValueIds) !==
      variant.combinationKey
  ) {
    return null;
  }

  return selectedValueIds;
}

function emptySelectionState(): ProductSelectionState {
  return {
    selectedValueIds: {},
    explicitlyTouchedOptionIds: [],
    selectionSource: "DEFAULT",
    quantity: MIN_QUANTITY,
    selectionRevision: 0,
    confirmedCombinationKey: null,
    confirmedRevision: null,
  };
}

export function createInitialSelection(
  product: Product,
  deepLinkedVariantId?: string | null,
): ProductSelectionState {
  const initial = emptySelectionState();
  const candidates = selectableVariants(product);

  if (deepLinkedVariantId) {
    const deepLinkedVariant = candidates.find(
      ({ id }) => id === deepLinkedVariantId,
    );
    if (deepLinkedVariant) {
      const selectedValueIds = selectionForVariant(product, deepLinkedVariant);
      if (selectedValueIds) {
        return {
          ...initial,
          selectedValueIds,
          selectionSource: "DEEP_LINK",
        };
      }
    }
  }

  if (candidates.length === 1) {
    const selectedValueIds = selectionForVariant(product, candidates[0]);
    if (selectedValueIds) return { ...initial, selectedValueIds };
  }

  return initial;
}

export function resolveSelection(
  product: Product,
  state: ProductSelectionState,
): ProductSelectionDerived {
  const candidates = selectableVariants(product);
  const selectionKey = combinationKeyForSelection(
    product.options,
    state.selectedValueIds,
  );
  const resolvedVariant =
    selectionKey === null
      ? null
      : (candidates.find(
          (variant) => variant.combinationKey === selectionKey,
        ) ?? null);
  const resolvedCombinationKey = resolvedVariant?.combinationKey ?? null;
  const defaultDisplayVariant =
    product.variants.find(
      ({ id }) => id === product.defaultDisplayVariantId,
    ) ?? null;
  const displayVariant = resolvedVariant ?? defaultDisplayVariant;
  const missingOptionIds = orderedOptions(product.options)
    .filter(
      (option) =>
        !option.values.some(
          ({ id }) => id === state.selectedValueIds[option.id],
        ),
    )
    .map(({ id }) => id);
  const purchaseConfirmed =
    resolvedVariant !== null &&
    ((state.selectionSource !== "DEEP_LINK" && candidates.length === 1) ||
      (state.confirmedCombinationKey === resolvedCombinationKey &&
        state.confirmedRevision === state.selectionRevision));
  const purchasableVariant =
    resolvedVariant?.sku && resolvedVariant.sku.availableInventory > 0
      ? resolvedVariant
      : null;

  return {
    resolvedVariant,
    resolvedCombinationKey,
    displayVariant,
    selectableVariants: candidates,
    purchasableVariant,
    purchaseConfirmed,
    missingOptionIds,
    price: displayVariant?.sku?.price ?? null,
    compareAtPrice: displayVariant?.sku?.compareAtPrice ?? null,
    availableInventory: displayVariant?.sku?.availableInventory ?? 0,
  };
}

function clearIncompatibleDownstreamSelections(
  product: Product,
  selectedValueIds: Record<string, string>,
  selectedOptionId: string,
): void {
  const options = orderedOptions(product.options);
  const selectedOptionIndex = options.findIndex(
    ({ id }) => id === selectedOptionId,
  );
  if (selectedOptionIndex < 0) return;

  const candidateSelections = selectableVariants(product)
    .map((variant) => selectionForVariant(product, variant))
    .filter((selection): selection is SelectedValueIds => selection !== null);
  const retained: Record<string, string> = {};

  for (let index = 0; index <= selectedOptionIndex; index += 1) {
    const optionId = options[index].id;
    const valueId = selectedValueIds[optionId];
    if (valueId !== undefined) retained[optionId] = valueId;
  }

  for (let index = selectedOptionIndex + 1; index < options.length; index += 1) {
    const optionId = options[index].id;
    const valueId = selectedValueIds[optionId];
    if (valueId === undefined) continue;

    const proposed = { ...retained, [optionId]: valueId };
    const compatible = candidateSelections.some((candidate) =>
      Object.entries(proposed).every(
        ([requiredOptionId, requiredValueId]) =>
          candidate[requiredOptionId] === requiredValueId,
      ),
    );
    if (compatible) retained[optionId] = valueId;
    else delete selectedValueIds[optionId];
  }
}

function sameSelection(
  left: SelectedValueIds,
  right: SelectedValueIds,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([optionId, valueId]) => right[optionId] === valueId)
  );
}

export function reduceProductSelection(
  product: Product,
  state: ProductSelectionState,
  action: ProductSelectionAction,
): ProductSelectionState {
  switch (action.type) {
    case "SELECT_OPTION": {
      const option = product.options.find(({ id }) => id === action.optionId);
      if (
        !option ||
        !option.values.some(({ id }) => id === action.valueId)
      ) {
        return state;
      }

      const selectedValueIds = {
        ...state.selectedValueIds,
        [action.optionId]: action.valueId,
      };
      clearIncompatibleDownstreamSelections(
        product,
        selectedValueIds,
        action.optionId,
      );
      const selectionChanged = !sameSelection(
        state.selectedValueIds,
        selectedValueIds,
      );
      const selectionRevision =
        state.selectionRevision + (selectionChanged ? 1 : 0);
      const explicitlyTouchedOptionIds =
        state.explicitlyTouchedOptionIds.includes(action.optionId)
          ? state.explicitlyTouchedOptionIds
          : [...state.explicitlyTouchedOptionIds, action.optionId];
      let next: ProductSelectionState = {
        ...state,
        selectedValueIds,
        explicitlyTouchedOptionIds,
        selectionSource: "USER",
        selectionRevision,
        confirmedCombinationKey: selectionChanged
          ? null
          : state.confirmedCombinationKey,
        confirmedRevision: selectionChanged ? null : state.confirmedRevision,
      };
      const derived = resolveSelection(product, next);
      const touchedEveryOption = product.options.every(({ id }) =>
        explicitlyTouchedOptionIds.includes(id),
      );
      if (touchedEveryOption && derived.resolvedCombinationKey !== null) {
        next = {
          ...next,
          confirmedCombinationKey: derived.resolvedCombinationKey,
          confirmedRevision: selectionRevision,
        };
      }
      return next;
    }

    case "CONFIRM": {
      const { resolvedCombinationKey } = resolveSelection(product, state);
      if (resolvedCombinationKey === null) return state;
      return {
        ...state,
        selectionSource: "CONFIRM_DIALOG",
        confirmedCombinationKey: resolvedCombinationKey,
        confirmedRevision: state.selectionRevision,
      };
    }

    case "SET_QUANTITY": {
      const quantity = normalizeQuantity(action.quantity);
      return quantity === state.quantity ? state : { ...state, quantity };
    }

    case "CHANGE_VARIANT":
      if (
        state.confirmedCombinationKey === null &&
        state.confirmedRevision === null &&
        state.selectionSource === "USER"
      ) {
        return state;
      }
      return {
        ...state,
        selectionSource: "USER",
        confirmedCombinationKey: null,
        confirmedRevision: null,
      };
  }
}
