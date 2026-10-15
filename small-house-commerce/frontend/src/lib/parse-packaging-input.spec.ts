import { describe, expect, it } from "vitest";
import { parsePackagingText, PRODUCT_SIZE_AXES } from "./parse-packaging-input";

describe("parsePackagingText", () => {
  const lwh = { packageWidth: 120, packageDepth: 60, packageHeight: 75 };

  it.each(["120 x 60 x 75 cm", "120 × 60 × 75 cm", "120*60*75 CM"])
    ("maps the admin LWH triplet in %s without swapping stored axes", input => {
      expect(parsePackagingText(input, "dimensions")).toMatchObject({
        fields: lwh, warnings: [], assumptions: [], complete: true,
      });
      expect(parsePackagingText(input, "dimensions", PRODUCT_SIZE_AXES).fields).toEqual(lwh);
    });

  it.each([
    "length: 120 cm, width: 60 cm, height: 75 cm",
    "L:120 cm; W:60 cm; H:75 cm",
    "L:120, W:60, H:75 cm",
  ])("uses explicit LWH labels and a shared trailing unit in %s", input => {
    expect(parsePackagingText(input, "dimensions")).toMatchObject({ fields: lwh, warnings: [], assumptions: [], complete: true });
  });

  it("reports missing dimension units once as an explicit cm assumption", () => {
    expect(parsePackagingText("120 x 60 x 75", "dimensions")).toMatchObject({
      fields: lwh, assumptions: ["Assumed cm for a value without a unit."], warnings: [], complete: true,
    });
  });

  it.each([
    ["300 x 200 x 100 mm", { packageWidth: 30, packageDepth: 20, packageHeight: 10 }],
    ["1 x 2 x 3 m", { packageWidth: 100, packageDepth: 200, packageHeight: 300 }],
    ["1 x 2 x 3 in", { packageWidth: 2.54, packageDepth: 5.08, packageHeight: 7.62 }],
    ["1 x 2 x 3 ft", { packageWidth: 30.48, packageDepth: 60.96, packageHeight: 91.44 }],
  ])("converts dimension units in %s", (input, fields) => {
    const result = parsePackagingText(input as string, "dimensions");
    for (const [key, value] of Object.entries(fields)) expect(result.fields[key as keyof typeof result.fields]).toBeCloseTo(value as number, 10);
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("preserves finite positive values instead of rounding them down to zero", () => {
    const result = parsePackagingText("length: 0.0000001 cm; height: 20 cm", "dimensions");
    expect(result.fields).toEqual({ packageWidth: 0.0000001, packageHeight: 20 });
    expect(result.warnings).toEqual([]);
  });

  it("converts labelled dimensions with different explicit units independently", () => {
    expect(parsePackagingText("W: 1 m, H: 20 in, L: 10 in, Weight: 500 g", "combined")).toMatchObject({
      fields: { packageWidth: 25.4, packageDepth: 100, packageHeight: 50.8, packageWeight: 0.5 },
      warnings: [], assumptions: [], complete: true,
    });
  });

  it.each([
    ["500 g", 0.5], ["2 kg", 2], ["1 lb", 0.45359237], ["1 oz", 0.028349523125],
  ])("converts %s into kilograms in explicit weight mode", (input, weight) => {
    const result = parsePackagingText(input as string, "weight");
    expect(result.fields.packageWeight).toBeCloseTo(weight as number, 12);
    expect(Object.keys(result.fields)).toEqual(["packageWeight"]);
    expect(result.complete).toBe(true);
  });

  it("allows a bare weight only in explicit weight mode and reports the kg assumption", () => {
    expect(parsePackagingText("2", "weight")).toMatchObject({
      fields: { packageWeight: 2 }, assumptions: ["Assumed kg for a value without a unit."], complete: true,
    });
    expect(parsePackagingText("2", "combined").fields).toEqual({});
    expect(parsePackagingText("2", "dimensions").fields).toEqual({});
  });

  it("parses dimensions and a package weight without producing volumetric weight", () => {
    const result = parsePackagingText("120 x 60 x 75 cm; weight: 5 kg", "combined");
    expect(result.fields).toEqual({ ...lwh, packageWeight: 5 });
    expect(result.complete).toBe(true);
    expect(result.fields).not.toHaveProperty("volumetricWeight");
    expect(Object.keys(result.fields).sort()).toEqual(["packageDepth", "packageHeight", "packageWeight", "packageWidth"]);
  });

  it("keeps dimension and weight modes separate", () => {
    expect(parsePackagingText("120x60x75cm; 5kg", "dimensions").fields).toEqual(lwh);
    expect(parsePackagingText("120x60x75cm; 5kg", "weight").fields).toEqual({ packageWeight: 5 });
  });

  it.each([
    ["length: 30 cm, length: 40 cm, height: 20 cm", { packageHeight: 20 }],
    ["length: 0 cm, length: 30 cm, height: 20 cm", { packageHeight: 20 }],
    ["length: 30 cm, length: 30 cm, height: 20 cm", { packageHeight: 20 }],
    ["30x20x10cm; 40x25x15cm", {}],
    ["weight: 2 kg; weight: 3 kg", {}],
    ["2 kg; 3 kg", {}],
    ["length: 30 inches; height: 20 cm", { packageHeight: 20 }],
    ["length: Infinity cm; height: 20 cm", { packageHeight: 20 }],
    ["length: NaN cm; height: 20 cm", { packageHeight: 20 }],
    ["length: -1 cm; height: 20 cm", { packageHeight: 20 }],
    ["weight: 1e309 kg", {}],
    ["weight: 0 kg", {}],
    ["weight: -2 kg", {}],
    ["30x20x10 yards", {}],
    ["120x60x75x10 cm", {}],
  ])("omits ambiguous or invalid candidates in %s", (input, fields) => {
    const result = parsePackagingText(input as string, "combined");
    expect(result.fields).toEqual(fields);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.complete).toBe(false);
  });

  it.each(["1,200 x 60 x 75 mm", "length: 30,5 cm", "weight: 1,2 kg"])
    ("rejects comma-formatted numbers rather than partially parsing %s", input => {
      const result = parsePackagingText(input, "combined");
      expect(result.fields).toEqual({});
      expect(result.warnings.length).toBeGreaterThan(0);
    });

  it.each(["net 4kg gross 5kg", "net weight 4 kg; gross weight 5 kg"])
    ("never guesses a single package weight from %s", input => {
      const result = parsePackagingText(input, "combined");
      expect(result.fields.packageWeight).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

  it("does not write a net weight into package weight", () => {
    const result = parsePackagingText("120x60x75cm; net weight 4kg", "combined");
    expect(result.fields).toEqual(lwh);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.each(["volumetric weight: 8 kg", "dimensional weight: 8 kg", "volumetricWeight: 8 kg", "体积重: 8 kg", "體積重: 8 kg"])
    ("does not mistake %s for physical package weight", input => {
      const result = parsePackagingText(input, "combined");
      expect(result.fields.packageWeight).toBeUndefined();
      expect(result.fields).not.toHaveProperty("volumetricWeight");
      expect(result.warnings.length).toBeGreaterThan(0);
    });

  it("rejects oversized text without partially extracting a valid prefix", () => {
    const result = parsePackagingText(`120x60x75cm;${" ".repeat(10001)}`, "combined");
    expect(result.fields).toEqual({});
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.complete).toBe(false);
  });

  it("returns no candidates for empty text", () => {
    expect(parsePackagingText("  ", "combined")).toMatchObject({ fields: {}, complete: false });
  });
});
