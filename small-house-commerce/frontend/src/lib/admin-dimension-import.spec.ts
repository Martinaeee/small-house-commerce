import { describe, expect, it } from "vitest";
import { emptyProductFormValue, emptySkuFormValue } from "@/components/admin/ProductForm";
import { dimensionFixture } from "./admin-dimension-import.test-utils";
import {
  parseProductDimensionInput, buildProductDimensionTargets, planProductDimensionImport,
  applyProductDimensionImport, applyProductDimensionPatch, dimensionDraftFingerprint,
  dimensionTargetSource,
} from "./admin-dimension-import";

const standard = { order: "LWH" as const, unit: "cm" as const };
const sizes = { productWidth: 120, productDepth: 60, productHeight: 75 };

describe("product dimension input", () => {
  it.each(["120×60×75cm", "120x60x75cm", "120*60*75 cm", "长120cm 宽600mm 高0.75m", "L120 W60 H75 cm"])("uses the existing converter for %s", raw => {
    expect(parseProductDimensionInput(raw, standard)).toMatchObject({ dimensions: sizes, issue: null });
  });
  it("retains the existing explicitly labelled weight suffix without importing it as a dimension", () => {
    expect(parseProductDimensionInput("120x60x75cm; weight 5kg", standard)).toMatchObject({ dimensions: sizes, issue: null });
  });

  it("requires an explicit order rather than guessing three unnamed numbers", () => {
    expect(parseProductDimensionInput("120×60×75cm", { order: "", unit: "" }).issue).toBe("dimension_issue_order");
    expect(parseProductDimensionInput("120×75×60cm", { order: "LHW", unit: "" }).dimensions).toEqual(sizes);
  });
  it("requires confirmation of a missing unit and retains labelled axes without an order", () => {
    expect(parseProductDimensionInput("长120 宽60 高75", { order: "", unit: "" }).issue).toBe("dimension_issue_unit");
    expect(parseProductDimensionInput("长120 宽60 高75", { order: "", unit: "cm" }).dimensions).toEqual(sizes);
  });
  it.each(["120x60", "120x60x75x10cm", "120x60x75cm 99", "0x60x75cm", "-1x60x75cm", "NaNx60x75cm", "Infinityx60x75cm", "120x60x75 yards", "1,200x60x75cm", "3-Tier 120x60x75cm"])("never applies a valid subset of %s", raw => {
    expect(parseProductDimensionInput(raw, standard).dimensions).toBeNull();
  });
  it.each(["包装120x60x75cm", "package 120x60x75cm", "折叠120x60x75cm"])("rejects a different dimension target in %s", raw => {
    expect(parseProductDimensionInput(raw, standard).issue).toBe("dimension_issue_target");
  });
  it("accepts a clearly labelled expanded size but requires the explicit folded target for folded text", () => {
    expect(parseProductDimensionInput("展开尺寸：长120 宽60 高75 cm", standard).dimensions).toEqual(sizes);
    expect(parseProductDimensionInput("折叠尺寸：长120 宽60 高75 cm", { ...standard, target: "folded" }).dimensions).toEqual(sizes);
    expect(parseProductDimensionInput("展开尺寸：长120 宽60 高75 cm", { ...standard, target: "folded" }).issue).toBe("dimension_issue_target");
  });

  it("converts tab-separated triples only after order confirmation", () => {
    expect(parseProductDimensionInput("1200\t600\t750", { order: "LWH", unit: "mm" }).dimensions).toEqual(sizes);
  });
});

describe("dimension targets and confirmation", () => {
  it("derives color groups while keeping style groups independent", () => {
    const form = dimensionFixture();
    const targets = buildProductDimensionTargets(form);
    expect(targets).toHaveLength(2);
    expect(targets[0].members.map(row => row.skuCode)).toEqual(["S-0", "S-1"]);
    expect(targets[1].members.map(row => row.skuCode)).toEqual(["S-2", "S-3"]);
    expect(dimensionTargetSource(targets[0], form)).toBe("inherited");
  });
  it("previews without touching source and applies only confirmed groups' product dimensions", () => {
    const form = dimensionFixture(), before = structuredClone(form);
    const plan = planProductDimensionImport(form, "S-0\t800x400x900mm\nS-2\t100x50x120cm", { ...standard, columns: ["sku", "dimensions"] });
    expect(form).toEqual(before);
    expect(plan.rows.map(row => row.issue)).toEqual([null, null]);
    const next = applyProductDimensionImport(form, plan, [plan.rows[0].id]);
    expect(next.graph!.variants.map(v => v.sku!.productWidth)).toEqual([80, 80, null, null]);
    expect(next.graph!.variants.map(v => v.sku!.price)).toEqual([100, 101, 102, 103]);
    expect(next.graph!.variants.map(v => v.sku!.onHand)).toEqual([5, 6, 7, 8]);
    expect(next.graph!.variants[0].sku).toMatchObject({ packageWidth: 130, packageDepth: 70, packageHeight: 85, productWeight: 4 });
    expect(next.foldedWidth).toBe("30");
    expect(form).toEqual(before);
  });
  it("rejects an oversized column count atomically even when its mapped dimensions are valid", () => {
    const plan = planProductDimensionImport(dimensionFixture(), ["S-0", "120x60x75cm", ...Array(19).fill("extra")].join("\t"), {
      ...standard, columns: ["sku", "dimensions", ...Array<"ignore">(19).fill("ignore")],
    });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].issue).toBe("dimension_issue_size");
  });
  it("maps explicitly chosen Excel columns without consuming SKU or tier digits", () => {
    const form = dimensionFixture();
    const plan = planProductDimensionImport(form, "变体\t高\t长\t宽\nBlack / 3-Tier\t750\t1200\t600", {
      order: "", unit: "mm", hasHeader: true, columns: ["variant", "height", "length", "width"],
    });
    expect(plan.rows[0]).toMatchObject({ dimensions: sizes, issue: null });
  });
  it("matches complete explicitly mapped option columns without guessing dimensions from tier names", () => {
    const plan = planProductDimensionImport(dimensionFixture(), "White\t3-Tier\t120x60x75cm", {
      ...standard, columns: ["option:color", "option:style", "dimensions"],
    });
    expect(plan.rows[0]).toMatchObject({ memberKey: "variant-1", dimensions: sizes, issue: null });
  });
  it("honors explicit axis-header units rather than treating the numbers as centimetres", () => {
    const plan = planProductDimensionImport(dimensionFixture(), "SKU\t长(mm)\t宽(mm)\t高(mm)\nS-0\t1200\t600\t750", {
      order: "", unit: "", hasHeader: true, columns: ["sku", "length", "width", "height"],
    });
    expect(plan.rows[0]).toMatchObject({ dimensions: sizes, inputUnit: "mm", issue: null });
  });
  it("rejects a value unit that disagrees with the declared header unit", () => {
    const plan = planProductDimensionImport(dimensionFixture(), "SKU\t长(mm)\t宽(mm)\t高(mm)\nS-0\t120cm\t600\t750", {
      ...standard, hasHeader: true, columns: ["sku", "length", "width", "height"],
    });
    expect(plan.rows[0].issue).toBe("dimension_issue_columns");
  });
  it("rejects an explicit row unit that disagrees with an axis-header unit", () => {
    const plan = planProductDimensionImport(dimensionFixture(), "SKU\t长(mm)\t宽(mm)\t高(mm)\t单位\nS-0\t1200\t600\t750\tcm", {
      order: "", unit: "", hasHeader: true, columns: ["sku", "length", "width", "height", "unit"],
    });
    expect(plan.rows[0].issue).toBe("dimension_issue_columns");
  });

  it("rejects an oversized batch as a whole instead of truncating the final rows", () => {
    const plan = planProductDimensionImport(dimensionFixture(), Array.from({ length: 101 }, (_, index) => `X-${index}\t120x60x75cm`).join("\n"), standard);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].issue).toBe("dimension_issue_size");
  });

  it("reports unknown, disabled and Bundle SKU targets rather than silently skipping them", () => {
    const form = dimensionFixture();
    form.graph!.variants[0].sku!.status = "DISABLED";
    form.graph!.variants[2].sku!.isBundle = true;
    const plan = planProductDimensionImport(form, "MISSING\t120x60x75\nS-0\t120x60x75\nS-2\t120x60x75", { ...standard, columns: ["sku", "dimensions"] });
    expect(plan.rows.every(row => row.issue !== null)).toBe(true);
    expect(() => applyProductDimensionImport(form, plan, plan.rows.map(row => row.id))).toThrow();
  });
  it("rejects repeated SKU rows even if their dimensions agree", () => {
    const plan = planProductDimensionImport(dimensionFixture(), "S-0\t120x60x75\nS-0\t120x60x75", { ...standard, columns: ["sku", "dimensions"] });
    expect(plan.rows.map(row => row.issue)).toEqual(["dimension_issue_duplicate", "dimension_issue_duplicate"]);
  });
  it("does not let the last color row win a conflicting group", () => {
    const form = dimensionFixture();
    const plan = planProductDimensionImport(form, "S-0\t120x60x75\nS-1\t80x40x90", { ...standard, columns: ["sku", "dimensions"] });
    expect(plan.rows.map(row => row.issue)).toEqual(["dimension_issue_group", "dimension_issue_group"]);
    expect(form.graph!.variants.every(v => v.sku!.productWidth === null)).toBe(true);
  });
  it("accepts agreeing different colors but applies their group only once", () => {
    const form = dimensionFixture();
    const plan = planProductDimensionImport(form, "S-0\t120x60x75\nS-1\t120x60x75", { ...standard, columns: ["sku", "dimensions"] });
    const next = applyProductDimensionImport(form, plan, plan.rows.map(row => row.id));
    expect(next.graph!.variants.map(v => v.sku!.productHeight)).toEqual([75, 75, null, null]);
  });
  it("invalidates a preview if defaults, group membership or target data changes", () => {
    const form = dimensionFixture();
    const plan = planProductDimensionImport(form, "S-0\t120x60x75", { ...standard, columns: ["sku", "dimensions"] });
    const changed = { ...form, width: "121" };
    expect(dimensionDraftFingerprint(changed)).not.toBe(plan.fingerprint);
    expect(() => applyProductDimensionImport(changed, plan, [plan.rows[0].id])).toThrow();
  });
  it("keeps partial inheritance and explicit zero separate, and clears only the chosen group's axes", () => {
    const form = dimensionFixture();
    for (const v of form.graph!.variants.slice(0, 2)) Object.assign(v.sku!, { productWidth: 0, productHeight: 80 });
    const target = buildProductDimensionTargets(form)[0];
    expect(dimensionTargetSource(target, form)).toBe("partial");
    const next = applyProductDimensionPatch(form, [target.key], { productWidth: null, productDepth: null, productHeight: null });
    expect(next.graph!.variants[0].sku).toMatchObject({ productWidth: null, productDepth: null, productHeight: null, packageWidth: 130 });
    expect(form.graph!.variants[0].sku!.productWidth).toBe(0);
  });
  it("does not normalize an unchanged mixed field while another axis is edited", () => {
    const form = dimensionFixture();
    form.graph!.variants[0].sku!.productWidth = 100;
    const target = buildProductDimensionTargets(form)[0];
    expect(dimensionTargetSource(target, form)).toBe("pending");
    const next = applyProductDimensionPatch(form, [target.key], { productHeight: 80 });
    expect(next.graph!.variants.slice(0, 2).map(v => v.sku!.productWidth)).toEqual([100, null]);
  });
  it("updates legacy dimensions without materializing a graph or changing SKU identities", () => {
    const form = emptyProductFormValue();
    form.graphTyped = false;
    form.graph = undefined;
    form.variants = [{ id: "old", clientKey: "old-key", name: "3-Tier", position: "0", sku: { ...emptySkuFormValue(), id: "old-sku", skuCode: "OLD-3", productWidth: "0" } }];
    const plan = planProductDimensionImport(form, "OLD-3\t120x60x75cm", { ...standard, columns: ["sku", "dimensions"] });
    const next = applyProductDimensionImport(form, plan, [plan.rows[0].id]);
    expect(next.variants[0]).toMatchObject({ id: "old", clientKey: "old-key", sku: { id: "old-sku", productWidth: "120", productDepth: "60", productHeight: "75" } });
    expect(next.graphTyped).toBe(form.graphTyped);
    expect(next.graph).toEqual(form.graph);
  });
});
