import { describe, expect, it } from "vitest";
import type { StorefrontOptionValue } from "./api";
import { collapseCardOptions } from "./product-card-options";

const values: StorefrontOptionValue[] = Array.from({ length: 8 }, (_, i) => ({
  id: `v${i}`, label: `Size ${i}`, position: i,
  swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
}));
const widths = Object.fromEntries(values.map(value => [value.id, 44]));

describe("collapseCardOptions", () => {
  it("reserves the extra-dimension entry even when the primary values alone fit", () => {
    const result = collapseCardOptions(values.slice(0, 3), "v2", widths, 140, 44, 4, true);
    expect(result.visibleValues.map(value => value.id)).toEqual(["v0", "v2"]);
    expect(result.hiddenCount).toBe(1);
  });

  it("does not hide primary values unnecessarily when More is required for another dimension", () => {
    const result = collapseCardOptions(values.slice(0, 2), "v1", widths, 140, 44, 4, true);
    expect(result.visibleValues.map(value => value.id)).toEqual(["v0", "v1"]);
    expect(result.hiddenCount).toBe(0);
  });
  it("reserves room for more and keeps a selected value beyond the prefix visible", () => {
    const result = collapseCardOptions(values, "v7", widths, 144, 44, 4);
    expect(result.visibleValues.map(value => value.id)).toEqual(["v0", "v7"]);
    expect(result.hiddenCount).toBe(6);
  });

  it("does not reserve a more button when every value fits", () => {
    const result = collapseCardOptions(values.slice(0, 3), undefined, widths, 140, 44, 4);
    expect(result.visibleValues.map(value => value.id)).toEqual(["v0", "v1", "v2"]);
    expect(result.hiddenCount).toBe(0);
  });

  it("uses measured widths rather than a fixed number of chips", () => {
    const result = collapseCardOptions(values, undefined, { ...widths, v0: 96, v1: 96 }, 144, 44, 4);
    expect(result.visibleValues.map(value => value.id)).toEqual(["v0"]);
    expect(result.hiddenCount).toBe(7);
  });

  it("retains the selected value as a narrow summary when its width exceeds capacity", () => {
    const result = collapseCardOptions(values, "v7", { ...widths, v7: 112 }, 90, 44, 4);
    expect(result.visibleValues.map(value => value.id)).toEqual(["v7"]);
    expect(result.hiddenCount).toBe(7);
  });

  it("accounts for gaps at the exact capacity boundary", () => {
    expect(collapseCardOptions(values, undefined, widths, 140, 44, 4).visibleValues.map(value => value.id))
      .toEqual(["v0", "v1"]);
    expect(collapseCardOptions(values, undefined, widths, 139, 44, 4).visibleValues.map(value => value.id))
      .toEqual(["v0"]);
  });

  it("does not mutate or duplicate values and ignores a foreign selected id", () => {
    const original = structuredClone(values);
    const result = collapseCardOptions(values, "foreign", widths, 144, 44, 4);
    expect(result.visibleValues.map(value => value.id)).toEqual(["v0", "v1"]);
    expect(result.hiddenCount).toBe(6);
    expect(values).toEqual(original);
  });

  it("handles an empty group without inventing a more button", () => {
    expect(collapseCardOptions([], undefined, {}, 144, 44, 4)).toEqual({ visibleValues: [], hiddenCount: 0 });
  });

  it("makes all unselected values reachable through more at zero capacity", () => {
    expect(collapseCardOptions(values, undefined, widths, 0, 44, 4)).toEqual({ visibleValues: [], hiddenCount: 8 });
  });
});
