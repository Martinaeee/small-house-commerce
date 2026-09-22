import { describe, expect, it } from "vitest";
import {
  formatOrderOptions,
  formatOrderOptionsFromSnapshot,
  formatOrderOptionsText,
  type OrderOptionSnapshotV1,
} from "./order-options";

/**
 * Display contract for an order line's authoritative option snapshot
 * (plan Task 18). The structured snapshot is the display source of truth;
 * the legacy `variantSnapshot` text is the historical fallback for lines
 * created before the typed option graph.
 */

const snapshot: OrderOptionSnapshotV1 = {
  version: 1,
  options: [
    { optionId: "color", optionValueId: "red", label: "Color", value: "Red" },
    { optionId: "size", optionValueId: "small", label: "Size", value: "Small" },
  ],
};

describe("formatOrderOptions", () => {
  it("returns the structured pairs in stored order", () => {
    expect(formatOrderOptions(snapshot, "Red / Small")).toEqual([
      { label: "Color", value: "Red" },
      { label: "Size", value: "Small" },
    ]);
  });

  it("falls back to the legacy variant text as one unlabeled entry when the snapshot is null", () => {
    expect(formatOrderOptions(null, "Red / Small")).toEqual([
      { label: "", value: "Red / Small" },
    ]);
  });

  it("falls back when the snapshot carries no entries (empty options array)", () => {
    expect(
      formatOrderOptions({ version: 1, options: [] }, "Red / Small"),
    ).toEqual([{ label: "", value: "Red / Small" }]);
  });

  it("falls back on an unrecognized future snapshot version instead of guessing its shape", () => {
    expect(
      formatOrderOptions(
        { version: 2, options: [] } as unknown as OrderOptionSnapshotV1,
        "Red / Small",
      ),
    ).toEqual([{ label: "", value: "Red / Small" }]);
  });

  it("returns no entries when there is neither a snapshot nor a legacy text", () => {
    expect(formatOrderOptions(null, null)).toEqual([]);
    expect(formatOrderOptions(null, "")).toEqual([]);
    expect(formatOrderOptions(null, "   ")).toEqual([]);
  });
});

describe("formatOrderOptionsText", () => {
  it("joins labeled pairs as 'Label: Value' with a middle dot", () => {
    expect(
      formatOrderOptionsText([
        { label: "Color", value: "Red" },
        { label: "Size", value: "Small" },
      ]),
    ).toBe("Color: Red · Size: Small");
  });

  it("renders unlabeled (historical fallback) entries bare", () => {
    expect(formatOrderOptionsText([{ label: "", value: "Red / Small" }])).toBe(
      "Red / Small",
    );
  });

  it("returns an empty string for no entries", () => {
    expect(formatOrderOptionsText([])).toBe("");
  });
});

describe("formatOrderOptionsFromSnapshot", () => {
  it("composes the formatter and text joiner for a structured snapshot", () => {
    expect(formatOrderOptionsFromSnapshot(snapshot, "Red / Small")).toBe(
      "Color: Red · Size: Small",
    );
  });

  it("renders the legacy variant text when the snapshot is absent", () => {
    expect(formatOrderOptionsFromSnapshot(null, "Red / Small")).toBe("Red / Small");
  });

  it("renders an empty string when neither source exists", () => {
    expect(formatOrderOptionsFromSnapshot(null, null)).toBe("");
  });
});
