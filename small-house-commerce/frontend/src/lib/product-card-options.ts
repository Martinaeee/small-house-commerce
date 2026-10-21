import type { StorefrontOptionValue } from "./api";

export function collapseCardOptions(
  values: readonly StorefrontOptionValue[],
  selectedValueId: string | undefined,
  widths: Readonly<Record<string, number>>,
  availableWidth: number,
  moreWidth: number,
  gap: number,
  forceMore = false,
): { visibleValues: StorefrontOptionValue[]; hiddenCount: number } {
  const width = (value: StorefrontOptionValue) => widths[value.id] ?? 44;
  const occupied = (rows: readonly StorefrontOptionValue[]) =>
    rows.reduce((sum, value) => sum + width(value), 0) + Math.max(0, rows.length - 1) * gap;
  if (occupied(values) + (forceMore ? moreWidth + gap : 0) <= availableWidth) return { visibleValues: [...values], hiddenCount: 0 };

  const budget = Math.max(0, availableWidth - moreWidth - gap);
  const visible: StorefrontOptionValue[] = [];
  for (const value of values) {
    if (occupied([...visible, value]) > budget) break;
    visible.push(value);
  }
  const selected = values.find(value => value.id === selectedValueId);
  if (selected && !visible.includes(selected)) {
    while (visible.length > 0 && occupied([...visible, selected]) > budget) visible.pop();
    visible.push(selected);
  }
  const visibleValues = values.filter(value => visible.includes(value));
  return { visibleValues, hiddenCount: values.length - visibleValues.length };
}
