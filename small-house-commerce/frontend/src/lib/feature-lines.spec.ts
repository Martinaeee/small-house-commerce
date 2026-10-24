import { describe, expect, it } from "vitest";
import {
  HIDDEN_FEATURE_PREFIX,
  featureLineText,
  isHiddenFeatureLine,
  parseFeatureLines,
  serializeFeatureLines,
  toggleFeatureLineVisibility,
  visibleFeatureLines,
} from "./feature-lines";

describe("feature lines", () => {
  it("treats a plain line as visible", () => {
    expect(isHiddenFeatureLine("Folds flat")).toBe(false);
    expect(featureLineText("Folds flat")).toBe("Folds flat");
  });

  it("reads the hidden marker off the stored line", () => {
    expect(isHiddenFeatureLine(`${HIDDEN_FEATURE_PREFIX}Folds flat`)).toBe(true);
    expect(featureLineText(`${HIDDEN_FEATURE_PREFIX}Folds flat`)).toBe("Folds flat");
  });

  it("toggles a line between hidden and visible without losing its text", () => {
    const hidden = toggleFeatureLineVisibility("Folds flat");
    expect(hidden).toBe(`${HIDDEN_FEATURE_PREFIX}Folds flat`);
    expect(toggleFeatureLineVisibility(hidden)).toBe("Folds flat");
  });

  it("splits stored text per line, trimming and dropping blanks", () => {
    expect(parseFeatureLines("  Folds flat \n\n Locking frame\n")).toEqual([
      "Folds flat",
      "Locking frame",
    ]);
    expect(parseFeatureLines(null)).toEqual([]);
  });

  it("returns only visible feature text for the storefront", () => {
    const stored = [
      "Folds flat",
      `${HIDDEN_FEATURE_PREFIX}Internal test bullet`,
      "Locking frame",
    ].join("\n");

    expect(visibleFeatureLines(stored)).toEqual(["Folds flat", "Locking frame"]);
  });

  it("serializes lines back to the one-per-line storage format", () => {
    expect(
      serializeFeatureLines([
        { text: " Folds flat ", hidden: false },
        { text: "Internal test bullet", hidden: true },
        { text: "   ", hidden: false },
      ]),
    ).toBe(`Folds flat\n${HIDDEN_FEATURE_PREFIX}Internal test bullet`);
    expect(serializeFeatureLines([])).toBeNull();
  });
});
