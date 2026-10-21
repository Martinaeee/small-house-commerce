import { describe, expect, it } from "vitest";
import type { Product, StorefrontProductVariant } from "@/lib/api";
import {
  analyzePdpSpecifications,
  formatLength,
  pdpInformationVisible,
  pdpFoldedGuideEntries,
  pdpSizeGuideRows,
  rowMatchesSelection,
  type PdpSpecCell,
} from "./pdp-specification-display";

function sku(overrides: Record<string, unknown> = {}) {
  return {
    id: "sku",
    skuCode: "SKU",
    status: "ACTIVE" as const,
    price: 100,
    compareAtPrice: null,
    availableInventory: 3,
    ...overrides,
  };
}

function variant(
  id: string,
  name: string,
  optionValueIds: string[],
  skuOverrides: Record<string, unknown> = {},
): StorefrontProductVariant {
  return {
    id,
    name,
    position: 0,
    combinationKey: optionValueIds.join("|"),
    optionValueIds,
    sku: sku({ id: `${id}-sku`, skuCode: id.toUpperCase(), ...skuOverrides }),
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "test-product",
    name: "Test product",
    slug: "test-product",
    description: null,
    tagline: null,
    categoryId: "category",
    ratingAverage: null,
    reviewCount: 0,
    room: null,
    internalRole: null,
    solutions: [],
    materials: "Solid oak",
    width: 94,
    height: 93,
    depth: 43,
    foldedWidth: 20,
    foldedHeight: 8,
    foldedDepth: 10,
    features: null,
    catalogGraphVersion: 1,
    options: [
      {
        id: "o-color",
        kind: "COLOR",
        name: "Color",
        position: 0,
        presentation: "TEXT",
        isMediaDriver: false,
        values: [
          { id: "black", label: "Black", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
          { id: "white", label: "White", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        ],
      },
      {
        id: "o-style",
        kind: "STYLE",
        name: "Style",
        position: 1,
        presentation: "TEXT",
        isMediaDriver: false,
        values: [
          { id: "short", label: "3-Tier", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
          { id: "tall", label: "4-Tier", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        ],
      },
    ],
    variants: [
      variant("bs", "Black / 3-Tier", ["black", "short"], { productWidth: 94, productDepth: 43, productHeight: 93, productWeight: 4, packageWeight: 5 }),
      variant("ws", "White / 3-Tier", ["white", "short"], { productWidth: 94, productDepth: 43, productHeight: 93, productWeight: 4, packageWeight: 5 }),
      variant("bt", "Black / 4-Tier", ["black", "tall"], { productWidth: 141, productDepth: 60, productHeight: 120, productWeight: 4, packageWeight: 5 }),
      variant("wt", "White / 4-Tier", ["white", "tall"], { productWidth: 141, productDepth: 60, productHeight: 120, productWeight: 4, packageWeight: 5 }),
    ],
    defaultDisplayVariantId: "bs",
    effectiveCoverMedia: null,
    images: [],
    ...overrides,
  };
}

const field = (p: Product, key: string) => {
  const model = analyzePdpSpecifications(p);
  const found = model.fields.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing field ${key}`);
  return found;
};
const format = (cell: PdpSpecCell) => {
  const model = analyzePdpSpecifications(product());
  return model.formatCell(cell);
};

describe("analyzePdpSpecifications", () => {
  it("classifies an equal weight and material as A while dimensions differ by the real style option", () => {
    const model = analyzePdpSpecifications(product());
    expect(model.fields.find((f) => f.key === "weight")?.classification).toBe("A");
    expect(model.fields.find((f) => f.key === "materials")?.classification).toBe("A");
    const dimensions = model.fields.find((f) => f.key === "dimensions");
    expect(dimensions?.classification).toBe("B");
    const group = model.groups.find((g) => g.fields.some((f) => f.key === "dimensions"));
    expect(group?.basis).toEqual(["o-style"]);
    expect(group?.rows.map((row) => row.labels.join(" · "))).toEqual(["3-Tier", "4-Tier"]);
  });

  it("keeps legal inheritance equal to explicit values and retains per-axis provenance", () => {
    const p = product();
    for (const v of p.variants) {
      Object.assign(v.sku!, { productWidth: null, productDepth: null, productHeight: null });
    }
    Object.assign(p.variants[0].sku!, { productWidth: 94, productDepth: 43, productHeight: 93 });
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((f) => f.key === "dimensions")?.classification).toBe("A");
    const explicit = model.rows.find((row) => row.id === "bs")!.cells.dimensions;
    const inherited = model.rows.find((row) => row.id === "ws")!.cells.dimensions;
    expect(explicit.sources[0]).toMatchObject({ field: "SKU.productWidth", inherited: false });
    expect(inherited.sources[0]).toMatchObject({ field: "Product.width", inherited: true });
  });

  it("treats a partially missing weight as C, never as a common value", () => {
    const p = product();
    Object.assign(p.variants[0].sku!, { productWeight: null, packageWeight: null });
    const model = analyzePdpSpecifications(p);
    const weight = model.fields.find((f) => f.key === "weight")!;
    expect(weight.classification).toBe("C");
    expect(model.common.some((f) => f.key === "weight")).toBe(false);
  });

  it("keeps known axes and marks a missing axis instead of inventing a full size", () => {
    const p = product();
    p.height = null;
    p.variants.forEach((v) => Object.assign(v.sku!, { productHeight: null }));
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((f) => f.key === "dimensions")?.classification).toBe("C");
    expect(model.formatCell(model.rows[0].cells.dimensions)).toMatch(/H not provided/);
  });

  it("hides a field that is missing everywhere without leaving an empty group", () => {
    const p = product({ materials: null });
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((f) => f.key === "materials")?.classification).toBe("D");
    expect(model.groups.some((g) => g.fields.some((f) => f.key === "materials"))).toBe(false);
  });

  it("keeps an explicit zero net weight as a real net weight", () => {
    const p = product();
    p.variants.forEach((v) => Object.assign(v.sku!, { productWeight: 0 }));
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((f) => f.key === "weight")?.classification).toBe("A");
    expect(model.formatCell(model.rows[0].cells.weight)).toBe("0 kg · Net weight");
  });

  it("never merges centimeter values that only look equal after rounding to a tenth of a centimetre", () => {
    const p = product();
    p.variants.forEach((v) => Object.assign(v.sku!, { productWidth: 94, productDepth: 43, productHeight: 93 }));
    Object.assign(p.variants[1].sku!, { productWidth: 94.01 });
    const model = analyzePdpSpecifications(p);
    const cells = model.rows.map((row) => model.formatCell(row.cells.dimensions));
    expect(new Set(cells).size).toBe(1);
    expect(model.fields.find((f) => f.key === "dimensions")?.classification).toBe("B");
  });

  it("keeps net 4 kg and gross 4 kg as different typed facts", () => {
    const p = product();
    Object.assign(p.variants[1].sku!, { productWeight: null, packageWeight: 4 });
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((f) => f.key === "weight")?.classification).toBe("B");
    const gross = model.rows.find((row) => row.id === "ws")!.cells.weight;
    expect(model.formatCell(gross)).toBe("4 kg · Gross weight");
  });

  it("hides weight entirely when both physical weights are absent", () => {
    const p = product();
    p.variants.forEach((v) => Object.assign(v.sku!, { productWeight: null, packageWeight: null }));
    expect(field(p, "weight").classification).toBe("D");
  });

  it("excludes disabled or unpriced variants from the analysis rows", () => {
    const p = product();
    Object.assign(p.variants[3].sku!, { status: "DISABLED" });
    const model = analyzePdpSpecifications(p);
    expect(model.rows.map((row) => row.id)).toEqual(["bs", "ws", "bt"]);
  });

  it("creates no difference table when every fact is equal despite different style names", () => {
    const p = product();
    p.variants.forEach((v) => Object.assign(v.sku!, { productWidth: 94, productDepth: 43, productHeight: 93 }));
    expect(analyzePdpSpecifications(p).groups).toEqual([]);
  });

  it("combines compatible differences into one table and coalesces equal vectors with exact members", () => {
    const p = product();
    Object.assign(p.variants[0].sku!, { productWidth: 100, productWeight: 4 });
    Object.assign(p.variants[1].sku!, { productWidth: 100, productWeight: 4 });
    Object.assign(p.variants[2].sku!, { productWidth: 141, productWeight: 5 });
    Object.assign(p.variants[3].sku!, { productWidth: 141, productWeight: 5 });
    const model = analyzePdpSpecifications(p);
    const group = model.groups.find((g) => g.fields.some((f) => f.key === "weight"));
    expect(group?.fields.map((f) => f.key)).toEqual(["dimensions", "weight"]);
    expect(group?.rows).toHaveLength(2);
    expect(group?.rows[1].memberIds).toEqual(["bt", "wt"]);
  });

  it("scopes sparse color availability instead of implying combinations that do not exist", () => {
    const p = product();
    p.variants = p.variants.filter((v) => v.id !== "wt");
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((f) => f.key === "colors")?.classification).toBe("B");
    const group = model.groups.find((g) => g.fields.some((f) => f.key === "colors"))!;
    expect(group.basis).toEqual(["o-style"]);
    const tall = group.rows.find((row) => row.memberIds.includes("bt"))!;
    expect(model.formatCell(tall.cells.colors)).toBe("Black");
  });

  it("keeps the full option combination when one-to-one options cannot be told apart", () => {
    const p = product();
    p.variants = [p.variants[0], p.variants[3]];
    const model = analyzePdpSpecifications(p);
    const group = model.groups.find((g) => g.fields.some((f) => f.key === "dimensions"))!;
    expect(group.basis).toEqual(["o-color", "o-style"]);
  });

  it("falls back to complete variant names when option bindings are incomplete", () => {
    const p = product();
    p.variants[0].optionValueIds = ["black"];
    const model = analyzePdpSpecifications(p);
    const group = model.groups.find((g) => g.fields.some((f) => f.key === "dimensions"))!;
    expect(group.basis).toEqual(["$variant"]);
    expect(group.rows).toHaveLength(4);
  });

  it("keeps known color facts and marks the missing binding rather than hiding every color", () => {
    const p = product();
    p.variants[3].optionValueIds = ["tall"];
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((entry) => entry.key === "colors")?.classification).toBe("C");
    expect(model.formatCell(model.rows.find((row) => row.id === "bs")!.cells.colors)).toBe("Black / White");
    expect(model.formatCell(model.rows.find((row) => row.id === "bt")!.cells.colors)).toBe("Black");
    expect(model.rows.find((row) => row.id === "wt")!.cells.colors.status).toBe("missing");
  });

  it("never derives grouping or dimensions from misleading names", () => {
    const p = product();
    p.variants.forEach((v) => {
      v.name = "9999-Tier Giant";
    });
    const model = analyzePdpSpecifications(p);
    const group = model.groups.find((g) => g.fields.some((f) => f.key === "dimensions"))!;
    expect(group.basis).toEqual(["o-style"]);
    expect(model.formatCell(group.rows[0].cells.dimensions)).toMatch(/94W/);
  });

  it("retains full variant names when reduced labels would be ambiguous", () => {
    const p = product();
    p.options[1].values.forEach((value) => {
      value.label = "Same label";
    });
    const model = analyzePdpSpecifications(p);
    const group = model.groups.find((g) => g.fields.some((f) => f.key === "dimensions"))!;
    expect(group.basis).toEqual(["$variant"]);
  });

  it("uses the real MATERIAL option value and never the unrelated product description", () => {
    const p = product();
    p.options[1] = {
      ...p.options[1],
      kind: "MATERIAL",
      values: [
        { id: "oak", label: "Oak", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        { id: "bamboo", label: "Bamboo", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
      ],
    };
    p.variants[0].optionValueIds = ["black", "oak"];
    p.variants[1].optionValueIds = ["white", "oak"];
    p.variants[2].optionValueIds = ["black", "bamboo"];
    p.variants[3].optionValueIds = ["white", "bamboo"];
    const model = analyzePdpSpecifications(p);
    expect(model.fields.find((f) => f.key === "materials")?.classification).toBe("B");
    expect(model.formatCell(model.rows.find((row) => row.id === "bt")!.cells.materials)).toBe("Bamboo");
  });

  it("marks a missing MATERIAL binding as missing instead of borrowing the product text", () => {
    const p = product();
    p.options[1] = { ...p.options[1], kind: "MATERIAL" };
    p.variants[0].optionValueIds = ["black"];
    const model = analyzePdpSpecifications(p);
    expect(model.rows.find((row) => row.id === "bs")!.cells.materials.status).toBe("missing");
  });

  it("compares free text exactly and keeps its original casing", () => {
    const p = product();
    p.materials = "Solid Oak";
    expect(field(p, "materials").classification).toBe("A");
    expect(format(field(p, "materials").cell)).toBe("Solid Oak");
    const p2 = product();
    p2.materials = "oak";
    const other = product();
    other.materials = "Oak";
    expect(field(p2, "materials").cell.signature).not.toBe(field(other, "materials").cell.signature);
  });

  it("keeps folded dimensions independent from assembled and packaging values", () => {
    const p = product();
    p.foldedWidth = null;
    p.foldedHeight = null;
    p.foldedDepth = null;
    expect(formatLength(p.foldedWidth)).toBe("Not provided");
    expect(formatLength(2.54)).toBe("2.5 cm");
    const model = analyzePdpSpecifications(p);
    expect(model.rows[0].cells.dimensions.value).toEqual([94, 43, 93]);
  });

  it("does not modify the source product", () => {
    const p = product();
    const before = JSON.stringify(p);
    analyzePdpSpecifications(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("still includes an out-of-stock variant and its real differing value", () => {
    const p = product();
    Object.assign(p.variants[3].sku!, { availableInventory: 0, productWeight: 10 });
    const model = analyzePdpSpecifications(p);
    expect(model.rows).toHaveLength(4);
    expect(model.fields.find((f) => f.key === "weight")?.classification).toBe("B");
  });

  it("handles one hundred variants by option ownership instead of a SKU card per variant", () => {
    const p = product();
    const colors = Array.from({ length: 10 }, (_, i) => ({ ...p.options[0].values[0], id: `color-${i}`, label: `Color ${i}`, position: i }));
    const styles = Array.from({ length: 10 }, (_, i) => ({ ...p.options[1].values[0], id: `style-${i}`, label: `Style ${i}`, position: i }));
    p.options[0].values = colors;
    p.options[1].values = styles;
    p.variants = colors.flatMap((color) => styles.map((style, i) => variant(`${color.id}-${style.id}`, `${color.label} / ${style.label}`, [color.id, style.id], {
      productWidth: 80 + i, productDepth: 40, productHeight: 90 + i, productWeight: 4,
    })));
    const model = analyzePdpSpecifications(p);
    expect(model.rows).toHaveLength(100);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].basis).toEqual(["o-style"]);
    expect(model.groups[0].rows).toHaveLength(10);
    expect(model.groups[0].rows.every((row) => row.memberIds.length === 10)).toBe(true);
  });

  it("keeps Bundle facts component-specific without parent dimensions or a guessed total", () => {
    const p = product({
      width: 999,
      height: 999,
      depth: 999,
      options: [],
      variants: [
        variant("bundle", "Dining Set", [], {
          specificationSource: "BUNDLE_COMPONENTS",
          productWidth: 999,
          productDepth: 999,
          productHeight: 999,
          packageWeight: 99,
          bundleComponents: [
            { productName: "Chair", variantName: "Oak", quantity: 2, width: 45, depth: 50, height: 80, foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Solid oak" },
            { productName: "Table", variantName: "White", quantity: 1, width: 120, depth: 60, height: 75, foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: null, materials: "Solid oak" },
          ],
        }),
      ],
    });
    const model = analyzePdpSpecifications(p);
    const dimensions = model.formatCell(model.rows[0].cells.dimensions);
    expect(dimensions).not.toMatch(/393\.3/);
    expect(dimensions).toMatch(/Chair \/ Oak × 2/);
    expect(model.formatCell(model.rows[0].cells.weight)).toMatch(/per item/);
    expect(model.formatCell(model.rows[0].cells.weight)).not.toMatch(/99 kg|8 kg|12 kg/);
    expect(model.fields.find((f) => f.key === "weight")?.classification).toBe("C");
  });
});

describe("pdpSizeGuideRows", () => {
  it("merges equal-size color members into one row joined with a slash", () => {
    const p = product({
      options: [product().options[0]],
      variants: [
        variant("black", "Black", ["black"], { productWidth: 120, productDepth: 60, productHeight: 75 }),
        variant("white", "White", ["white"], { productWidth: 120, productDepth: 60, productHeight: 75 }),
      ],
    });
    const rows = pdpSizeGuideRows(p);
    expect(rows).toHaveLength(1);
    expect(rows[0].labels).toEqual(["Black / White"]);
  });

  it("labels specification-bearing rows by their real style values", () => {
    const rows = pdpSizeGuideRows(product());
    expect(rows.map((row) => row.labels.join(" · "))).toEqual(["3-Tier", "4-Tier"]);
  });

  it("coalesces identical sizes even when another fact differs within the same option group", () => {
    const p = product();
    p.options = [p.options[1]];
    p.options[0].values.push({ ...p.options[0].values[1], id: "middle", label: "Middle" });
    p.variants = [
      variant("short", "3-Tier", ["short"], { productWidth: 94, productDepth: 43, productHeight: 93, productWeight: 4 }),
      variant("middle", "Middle", ["middle"], { productWidth: 94, productDepth: 43, productHeight: 93, productWeight: 5 }),
      variant("tall", "4-Tier", ["tall"], { productWidth: 141, productDepth: 60, productHeight: 120, productWeight: 6 }),
    ];
    const rows = pdpSizeGuideRows(p);
    expect(rows).toHaveLength(2);
    expect(rows[0].labels).toEqual(["3-Tier", "Middle"]);
    expect(rows[0].memberIds).toEqual(["short", "middle"]);
  });

  it("returns no rows when no variant has any real dimensions", () => {
    const p = product({ width: null, height: null, depth: null });
    p.variants.forEach((v) => Object.assign(v.sku!, { productWidth: null, productDepth: null, productHeight: null }));
    expect(pdpSizeGuideRows(p)).toEqual([]);
  });
});

describe("pdpFoldedGuideEntries", () => {
  it("shows ordinary shared folded dimensions once", () => {
    expect(pdpFoldedGuideEntries(product())).toEqual([{ label: null, values: [20, 10, 8] }]);
  });

  it("keeps ordinary and Bundle folded dimensions scoped to their actual variant", () => {
    const p = product({ options: [] });
    p.variants = [
      variant("ordinary", "Table", []),
      variant("bundle", "Dining Set", [], {
        specificationSource: "BUNDLE_COMPONENTS",
        bundleComponents: [{ productName: "Chair", variantName: "Oak", quantity: 2, width: 45, depth: 50, height: 80,
          foldedWidth: 50, foldedDepth: 40, foldedHeight: 12, productWeight: 4, materials: "Wood" }],
      }),
      variant("missing", "Empty set", [], { specificationSource: "BUNDLE_COMPONENTS", bundleComponents: [] }),
    ];
    expect(pdpFoldedGuideEntries(p)).toEqual([
      { label: "Table", values: [20, 10, 8] },
      { label: "Dining Set — Chair / Oak × 2", values: [50, 40, 12] },
      { label: "Empty set", values: [null, null, null] },
    ]);
  });
});

describe("pdpInformationVisible", () => {
  it("is visible when any real specification field carries a value", () => {
    expect(pdpInformationVisible(product())).toBe(true);
    const colorsOnly = product({ materials: null, width: null, height: null, depth: null });
    colorsOnly.variants.forEach((v) => Object.assign(v.sku!, { productWidth: null, productDepth: null, productHeight: null, productWeight: null, packageWeight: null }));
    expect(pdpInformationVisible(colorsOnly)).toBe(true);
  });

  it("stays hidden for an empty Bundle definition and for products with no specification facts", () => {
    const empty = product({ options: [], width: null, height: null, depth: null, materials: null });
    empty.variants = [variant("plain", "Default", [], {})];
    expect(pdpInformationVisible(empty)).toBe(false);
    const emptyBundle = product({
      options: [],
      variants: [variant("bundle", "Dining Set", [], { specificationSource: "BUNDLE_COMPONENTS", bundleComponents: [] })],
    });
    expect(pdpInformationVisible(emptyBundle)).toBe(false);
  });
});

describe("rowMatchesSelection", () => {
  it("matches a row against selected option value ids without parsing names", () => {
    const model = analyzePdpSpecifications(product());
    const row = model.rows.find((entry) => entry.id === "bt")!;
    expect(rowMatchesSelection(row, { "o-style": "tall" })).toBe(true);
    expect(rowMatchesSelection(row, { "o-style": "tall", "o-color": "white" })).toBe(false);
  });
});
