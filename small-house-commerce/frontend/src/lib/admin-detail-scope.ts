/**
 * Detail-media scope helpers. The detail block row stores an exclusive pair of
 * option-value / exact-variant ids; the upload row and the per-image select
 * exchange a single `option:<id>` / `variant:<id>` string.
 */

export interface DetailMediaScope {
  optionValueId: string;
  variantId: string;
}

export interface DetailScopeOption {
  value: string;
  label: string;
}

export function detailScopeFromValue(value: string): DetailMediaScope {
  if (value.startsWith("variant:")) {
    return { optionValueId: "", variantId: value.slice("variant:".length) };
  }
  if (value.startsWith("option:")) {
    return { optionValueId: value.slice("option:".length), variantId: "" };
  }
  return { optionValueId: "", variantId: "" };
}

export function detailScopeValue(block: {
  optionValueId?: string | null;
  variantId?: string | null;
}): string {
  if (block.variantId) return `variant:${block.variantId}`;
  if (block.optionValueId) return `option:${block.optionValueId}`;
  return "";
}

export function detailScopeLabel(
  value: string,
  options: readonly DetailScopeOption[],
): string | undefined {
  return options.find((option) => option.value === value)?.label;
}
