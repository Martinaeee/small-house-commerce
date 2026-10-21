import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product, StorefrontSku } from "@/lib/api";
import {
  fetchCategoryInfo,
  selectRelatedProducts,
  selectableAvailableInventory,
} from "./pdp-products";

afterEach(() => vi.unstubAllGlobals());

function candidate(
  id: string,
  skus: Array<Partial<StorefrontSku> | null>,
): Product {
  return {
    id,
    variants: skus.map((sku, index) => ({
      id: `${id}-variant-${index}`,
      name: `${id} ${index}`,
      position: index,
      combinationKey: `${id}:${index}`,
      optionValueIds: [],
      sku:
        sku === null
          ? null
          : {
              id: `${id}-sku-${index}`,
              skuCode: `${id}-${index}`,
              status: "ACTIVE",
              price: 100,
              compareAtPrice: null,
              availableInventory: 0,
              ...sku,
            },
    })),
  } as unknown as Product;
}

describe("selectableAvailableInventory", () => {
  it("sums only inventory attached to active priced SKUs", () => {
    expect(
      selectableAvailableInventory(
        candidate("mixed", [
          { status: "ACTIVE", price: 100, availableInventory: 3 },
          { status: "ACTIVE", price: 0, availableInventory: 2 },
          { status: "ACTIVE", price: null, availableInventory: 9 },
          { status: "DISABLED", price: 100, availableInventory: 11 },
          null,
        ]),
      ),
    ).toBe(5);
  });
});

describe("selectRelatedProducts", () => {
  it("excludes current and non-buyable products, preserves API order, and caps four", () => {
    const current = candidate("current", [{ availableInventory: 8 }]);
    const outOfStock = candidate("oos", [{ availableInventory: 0 }]);
    const disabledStock = candidate("disabled", [
      { status: "DISABLED", availableInventory: 20 },
    ]);
    const unpricedStock = candidate("unpriced", [
      { price: null, availableInventory: 20 },
    ]);
    const valid = ["a", "b", "c", "d", "e"].map((id, index) =>
      candidate(id, [{ availableInventory: index + 1 }]),
    );

    expect(
      selectRelatedProducts(
        [
          current,
          outOfStock,
          valid[0]!,
          disabledStock,
          valid[1]!,
          unpricedStock,
          valid[2]!,
          valid[3]!,
          valid[4]!,
        ],
        current.id,
      ).map(({ id }) => id),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("returns the real smaller set and honors an explicit limit", () => {
    const products = [
      candidate("a", [{ availableInventory: 1 }]),
      candidate("b", [{ availableInventory: 2 }]),
    ];

    expect(selectRelatedProducts(products, "other", 1)).toEqual([products[0]]);
    expect(selectRelatedProducts(products, "other", 4)).toEqual(products);
  });
});

describe("fetchCategoryInfo", () => {
  const tree = [
    { id: "unrelated", name: "Other", slug: "other", children: [] },
    { id: "root", name: "Furniture", slug: "furniture", children: [
      { id: "sibling", name: "Tables", slug: "tables", children: [] },
      { id: "leaf", name: "Chairs", slug: "chairs", children: [] },
    ] },
  ];

  it("returns the root-to-leaf chain without unrelated sibling crumbs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(tree))));
    expect(await fetchCategoryInfo("leaf")).toEqual([
      { name: "Furniture", slug: "furniture" },
      { name: "Chairs", slug: "chairs" },
    ]);
  });

  it("returns null when the category is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(tree))));
    expect(await fetchCategoryInfo("missing")).toBeNull();
  });

  it.each(["http", "network"])("returns null on %s failure", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failure === "network") throw new Error("Network unavailable");
      return new Response("Unavailable", { status: 503 });
    }));
    expect(await fetchCategoryInfo("leaf")).toBeNull();
  });
});
