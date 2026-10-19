import { describe, expect, it } from "vitest";
import {
  mergeSectionStyles,
  normalizeModuleLayout,
  patchResponsiveFields,
  resolveResponsiveFields,
  resolveModuleLayout,
  moduleLayoutPresentation,
} from "./homepage-responsive";

const defaults = {
  desktop: { columns: 6, gap: 16 },
  tablet: { columns: 3, gap: 16 },
  mobile: { columns: 2, gap: 16 },
};

describe("responsive homepage fields", () => {
  it("uses a mobile category rail only while columns are automatic", () => {
    const auto = moduleLayoutPresentation("CATEGORY_TILES", { overrides: { mobile: { gap: 0 } } }, "mobile", undefined, "STUDIO_V3")!;
    expect(auto.style.gridAutoFlow).toBe("column");
    expect(auto.style.gridTemplateColumns).toBe("none");
    expect(auto.style.gap).toBe(0);
    const manual = moduleLayoutPresentation("CATEGORY_TILES", { columns: 3 }, "mobile", undefined, "STUDIO_V3")!;
    expect(manual.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(manual.style.gridAutoFlow).not.toBe("column");
    expect(moduleLayoutPresentation("CATEGORY_TILES", undefined, "tablet", undefined, "STUDIO_V3")?.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("sizes the mobile category rail to the approved circle width so fixed tracks overflow and swipe", () => {
    const autoCol = (style: React.CSSProperties) => (style as Record<string, unknown>)["--hp-layout-mobile-auto-col"];
    const auto = moduleLayoutPresentation("CATEGORY_TILES", undefined, undefined, undefined, "STUDIO_V3")!;
    expect(autoCol(auto.style)).toBe("104px");
    const manual = moduleLayoutPresentation("CATEGORY_TILES", { columns: 3 }, undefined, undefined, "STUDIO_V3")!;
    expect(autoCol(manual.style)).toBeUndefined();
    expect(autoCol(moduleLayoutPresentation("CATEGORY_TILES", undefined, undefined, 2, "STUDIO_V3")!.style)).toBeUndefined();
  });

  it("allows automatic product columns to shrink within a narrow container without stretching the last product", () => {
    const auto = moduleLayoutPresentation("PRODUCT_GRID", undefined, "desktop", undefined, "STUDIO_V3")!;
    expect(auto.style.gridTemplateColumns).toContain("auto-fill");
    expect(auto.style.gridTemplateColumns).toContain("200px");
    expect(moduleLayoutPresentation("PRODUCT_GRID", undefined, "mobile", undefined, "STUDIO_V3")?.style.rowGap).toBe(20);
    expect(moduleLayoutPresentation("PRODUCT_GRID", { gap: 0 }, "mobile", undefined, "STUDIO_V3")?.style.rowGap).toBe(0);
    expect(moduleLayoutPresentation("PRODUCT_GRID", { columns: 2 }, "desktop", undefined, "STUDIO_V3")?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(moduleLayoutPresentation("PRODUCT_GRID", undefined, "mobile", 2, "STUDIO_V3")?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it.each([
    ["CATEGORY_TILES", "desktop", 32], ["CATEGORY_TILES", "tablet", 24], ["CATEGORY_TILES", "mobile", 16],
    ["PRODUCT_GRID", "desktop", 24], ["PRODUCT_GRID", "tablet", 20], ["PRODUCT_GRID", "mobile", 12],
    ["PRODUCT_STORY", "desktop", 48], ["PRODUCT_STORY", "tablet", 28], ["PRODUCT_STORY", "mobile", 20],
  ] as const)("uses the selected airy gap for %s/%s without writing a layout", (type, device, gap) => {
    expect(moduleLayoutPresentation(type, undefined, device)).toBeUndefined();
    expect(moduleLayoutPresentation(type, undefined, device, undefined, "STUDIO_V3")?.style.gap).toBe(gap);
    expect(resolveModuleLayout(type, undefined, device, undefined, "STUDIO_V3").gap).toBe(gap);
  });

  it("keeps explicit zero, device gap and old two-column grids ahead of airy fallbacks", () => {
    expect(resolveModuleLayout("PRODUCT_STORY", { gap: 0 }, "mobile", undefined, "STUDIO_V3").gap).toBe(0);
    expect(resolveModuleLayout("PRODUCT_STORY", { gap: 0, overrides: { mobile: { gap: 7 } } }, "mobile", undefined, "STUDIO_V3").gap).toBe(7);
    for (const device of ["desktop", "tablet", "mobile"] as const) {
      expect(resolveModuleLayout("PRODUCT_GRID", undefined, device, 2, "STUDIO_V3").columns).toBe(2);
    }
  });

  it("changes only the selected mobile field without freezing automatic columns", () => {
    const value = patchResponsiveFields(undefined, "mobile", { gap: 8 });
    expect(value).toEqual({ overrides: { mobile: { gap: 8 } } });
    expect(resolveResponsiveFields(defaults, value, "mobile")).toEqual({ columns: 2, gap: 8 });
    expect(resolveResponsiveFields(defaults, value, "desktop")).toEqual({ columns: 6, gap: 16 });
    expect(resolveResponsiveFields(defaults, value, "tablet")).toEqual({ columns: 3, gap: 16 });
  });

  it("removes one override and inherits the current common value without losing siblings", () => {
    const original = { gap: 24, overrides: { mobile: { gap: 8, columns: 3 } } };
    const next = patchResponsiveFields(original, "mobile", { gap: undefined });
    expect(next).toEqual({ gap: 24, overrides: { mobile: { columns: 3 } } });
    expect(resolveResponsiveFields(defaults, next, "mobile")).toEqual({ columns: 3, gap: 24 });
    expect(original.overrides.mobile.gap).toBe(8);
  });

  it("prunes empty containers and preserves explicit zero", () => {
    const changed = patchResponsiveFields(undefined, "mobile", { gap: 0 });
    expect(resolveResponsiveFields(defaults, changed, "mobile").gap).toBe(0);
    expect(patchResponsiveFields(changed, "mobile", { gap: undefined })).toBeUndefined();
  });

  it("does not let tablet overrides leak into mobile", () => {
    expect(resolveResponsiveFields(defaults, { overrides: { tablet: { columns: 1 } } }, "mobile"))
      .toEqual({ columns: 2, gap: 16 });
  });

  it("keeps section common ahead of global mobile and preserves unrelated global fields", () => {
    const style = mergeSectionStyles(
      { paddingTop: 40, overrides: { mobile: { paddingTop: 12, paddingBottom: 10 } } },
      { paddingTop: 30, overrides: { mobile: { contentWidth: "FULL" } } },
    );
    expect(resolveResponsiveFields({ desktop: {}, tablet: {}, mobile: {} }, style, "mobile"))
      .toEqual({ paddingTop: 30, paddingBottom: 10, contentWidth: "FULL" });
    expect(resolveResponsiveFields({ desktop: {}, tablet: {}, mobile: {} }, style, "desktop"))
      .toEqual({ paddingTop: 30 });
  });

  it("gives section device values final precedence", () => {
    expect(mergeSectionStyles(
      { paddingTop: 40, overrides: { mobile: { paddingTop: 12 } } },
      { paddingTop: 30, overrides: { mobile: { paddingTop: 0 } } },
    )).toEqual({ paddingTop: 30, overrides: { mobile: { paddingTop: 0 } } });
  });

  it("preserves old shallow style merging and absence", () => {
    expect(mergeSectionStyles(undefined, undefined)).toBeUndefined();
    expect(mergeSectionStyles({ paddingTop: 24 }, { contentWidth: "NARROW" }))
      .toEqual({ paddingTop: 24, contentWidth: "NARROW" });
  });

  it("preserves sparse supported layouts and drops invalid or inappropriate fields", () => {
    expect(normalizeModuleLayout("CATEGORY_TILES", {
      columns: 6, overrides: { mobile: { gap: 0, columns: 3 } },
    })).toEqual({ columns: 6, overrides: { mobile: { gap: 0, columns: 3 } } });
    expect(normalizeModuleLayout("PRODUCT_GRID", {
      columns: 2.5, imageRatio: "SQUARE", overrides: { mobile: { gap: Infinity } },
    })).toEqual({});
    expect(normalizeModuleLayout("PRODUCT_STORY", undefined)).toBeUndefined();
  });
});
