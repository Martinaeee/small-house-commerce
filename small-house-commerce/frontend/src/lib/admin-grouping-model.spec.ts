import { describe, expect, it } from "vitest";
import {
  buildUnifiedGroups,
  flattenUnifiedGroups,
  type UnifiedGroupInput,
} from "./admin-grouping-model";
import type {
  AdminCategoryNode,
  AdminCollectionRow,
  AdminProduct,
} from "./admin-api";

function category(
  patch: Partial<AdminCategoryNode> & { id: string; name: string; slug: string },
): AdminCategoryNode {
  return {
    parentId: null,
    sortOrder: 0,
    imageUrl: null,
    status: "ACTIVE",
    heroStyle: null,
    children: [],
    ...patch,
  };
}

function collection(
  patch: Partial<AdminCollectionRow> & { id: string; name: string; slug: string },
): AdminCollectionRow {
  return {
    type: "MARKETING",
    description: null,
    seoTitle: null,
    seoDescription: null,
    status: "ACTIVE",
    sortOrder: 0,
    heroImage: null,
    heroStyle: null,
    _count: { products: 0 },
    ...patch,
  };
}

function product(
  patch: Pick<AdminProduct, "id" | "name" | "categoryId"> & {
    status?: AdminProduct["status"];
  },
): AdminProduct {
  return {
    slug: patch.id,
    productCode: null,
    description: null,
    tagline: null,
    status: patch.status ?? "ACTIVE",
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
    createdAt: "",
    updatedAt: "",
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    detailBlocks: [],
    variants: [],
    ...patch,
  } as unknown as AdminProduct;
}

const A1 = category({
  id: "cat-a1",
  parentId: "cat-a",
  name: "Shelving",
  slug: "shelving",
  sortOrder: 1,
});
const A = category({
  id: "cat-a",
  name: "Storage",
  slug: "storage",
  sortOrder: 2,
  children: [A1],
});
A1.parentId = A.id;

const SAME_SLUG_COLLECTION = collection({
  id: "col-a",
  name: "Storage",
  slug: "storage",
  type: "NAVIGATION",
  sortOrder: 2,
  _count: { products: 1 },
});
const MARKETING = collection({
  id: "col-new",
  name: "New Arrivals",
  slug: "new-arrivals",
  type: "MARKETING",
  sortOrder: 7,
  _count: { products: 2 },
});

const PRODUCTS = [
  product({ id: "p1", name: "Root active", categoryId: "cat-a" }),
  product({ id: "p2", name: "Child active + member", categoryId: "cat-a1" }),
  product({ id: "p3", name: "Root draft", categoryId: "cat-a", status: "DRAFT" }),
  product({ id: "p4", name: "Child active", categoryId: "cat-a1" }),
  product({ id: "p5", name: "Marketing member", categoryId: "cat-a" }),
];

const INPUT: UnifiedGroupInput = {
  categories: [A],
  collections: [SAME_SLUG_COLLECTION, MARKETING],
  products: PRODUCTS,
  memberIdsBySlug: {
    // p2 is already in the category subtree -> must not be double counted.
    storage: ["p2", "p5"],
    "new-arrivals": ["p5", "p1"],
  },
};

describe("buildUnifiedGroups", () => {
  it("merges a same-slug collection into its category row", () => {
    const rows = buildUnifiedGroups(INPUT);
    const storageRows = rows.filter((row) => row.slug === "storage");
    expect(storageRows).toHaveLength(1);
    expect(storageRows[0].kind).toBe("CATEGORY");
    expect(storageRows[0].collectionId).toBe("col-a");
    // The collection is not also listed as a flat marketing row.
    expect(rows.some((row) => row.id === "col-a")).toBe(false);
  });

  it("computes direct, member, subtree and active counts with dedupe", () => {
    const [storage, marketing] = buildUnifiedGroups(INPUT);
    expect(storage.counts).toEqual({
      direct: 3, // p1 + p3 + p5 (all statuses, primary only)
      memberCount: 2, // storage members p2 + p5
      subtree: 5, // p1, p2, p3, p4 primary subtree + p5 member, deduped
      active: 4, // p1, p2, p4, p5
    });
    expect(storage.children[0].counts).toEqual({
      direct: 2, // p2 + p4
      memberCount: 0,
      subtree: 2,
      active: 2,
    });
    expect(marketing.counts).toEqual({
      direct: 2,
      memberCount: 2,
      subtree: 2,
      active: 2,
    });
  });

  it("flattens only expanded branches, preserving depth", () => {
    const rows = buildUnifiedGroups(INPUT);
    const collapsed = flattenUnifiedGroups(rows, new Set());
    expect(collapsed.map((row) => row.slug)).toEqual(["storage", "new-arrivals"]);
    expect(collapsed[0].depth).toBe(0);

    const expanded = flattenUnifiedGroups(rows, new Set(["cat-a"]));
    expect(expanded.map((row) => row.slug)).toEqual([
      "storage",
      "shelving",
      "new-arrivals",
    ]);
    expect(expanded[1].depth).toBe(1);
  });
});
