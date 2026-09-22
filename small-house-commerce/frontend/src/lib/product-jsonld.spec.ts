import { describe, expect, it } from "vitest";
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "./api";
import { SITE_URL, buildProductJsonLd } from "./product-jsonld";

/**
 * Task 19: per-SKU SEO offers (design spec §12.4). Every ACTIVE, priced SKU
 * gets one Offer with a precise variant URL, honest per-SKU availability and
 * an option-label description, while the Product node itself stays canonical
 * to the queryless PDP URL (?variant= never becomes an indexed page).
 */

function option(
  id: string,
  name: string,
  values: { id: string; label: string }[],
): StorefrontProductOption {
  return {
    id,
    kind: id === "color" ? "COLOR" : "SIZE",
    name,
    position: id === "color" ? 0 : 1,
    presentation: "TEXT",
    isMediaDriver: false,
    values: values.map((value, index) => ({
      id: value.id,
      label: value.label,
      position: index,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
    })),
  };
}

function variant(
  id: string,
  name: string,
  optionValueIds: string[],
  sku: StorefrontProductVariant["sku"],
): StorefrontProductVariant {
  return { id, name, position: 0, combinationKey: id, optionValueIds, sku };
}

function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Rattan Chair",
    slug: "rattan-chair",
    description: "A handwoven rattan chair.",
    tagline: null,
    categoryId: "cat-1",
    ratingAverage: null,
    reviewCount: 0,
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    catalogGraphVersion: 1,
    options: [
      option("color", "Color", [
        { id: "value-red", label: "Red" },
        { id: "value-blue", label: "Blue" },
      ]),
      option("size", "Size", [
        { id: "value-small", label: "Small" },
        { id: "value-large", label: "Large" },
      ]),
    ],
    defaultDisplayVariantId: null,
    effectiveCoverMedia: null,
    images: [],
    variants: [],
    ...overrides,
  };
}

function skuFixture(overrides: {
  status?: "ACTIVE" | "DISABLED";
  price?: number | null;
  availableInventory?: number;
}) {
  return {
    id: `sku-${overrides.status ?? "x"}`,
    skuCode: `CODE-${overrides.status ?? "X"}`,
    status: overrides.status ?? ("ACTIVE" as const),
    price: overrides.price ?? 1299,
    compareAtPrice: null,
    availableInventory: overrides.availableInventory ?? 5,
  };
}

function findProductNode(graph: unknown): Record<string, unknown> {
  const nodes = (graph as { "@graph"?: Record<string, unknown>[] })["@graph"];
  return (nodes ?? []).find((node) => node["@type"] === "Product") ?? {};
}

describe("buildProductJsonLd per-SKU offers", () => {
  it("emits exactly one Offer per ACTIVE, priced SKU", () => {
    const product = productFixture({
      variants: [
        // Sellable, in stock.
        variant("variant-red-small", "Red Small", ["value-red", "value-small"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-red-small",
          skuCode: "RC-RS",
          availableInventory: 3,
        }),
        // Sellable, but sold out — still an offer, honestly out of stock.
        variant("variant-red-large", "Red Large", ["value-red", "value-large"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-red-large",
          skuCode: "RC-RL",
          price: 1499,
          availableInventory: 0,
        }),
        // Disabled SKU: never an offer.
        variant("variant-blue-small", "Blue Small", ["value-blue", "value-small"], {
          ...skuFixture({ status: "DISABLED" }),
          id: "sku-blue-small",
          skuCode: "RC-BS",
        }),
        // Unpriced SKU: never an offer.
        variant("variant-blue-large", "Blue Large", ["value-blue", "value-large"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-blue-large",
          skuCode: "RC-BL",
          price: null,
        }),
        // No SKU at all: never an offer.
        variant("variant-bare", "Bare", ["value-blue", "value-small"], null),
      ],
    });

    const node = findProductNode(buildProductJsonLd(product, null));
    const offers = node.offers as Record<string, unknown>[];

    expect(offers).toHaveLength(2);
    expect(offers.map((offer) => offer.sku)).toEqual(["RC-RS", "RC-RL"]);
  });

  it("describes each offer with precise variant URL, price, availability and option labels", () => {
    const product = productFixture({
      variants: [
        variant("variant-red-small", "Red Small", ["value-red", "value-small"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-red-small",
          skuCode: "RC-RS",
          price: 1299,
          availableInventory: 3,
        }),
        variant("variant-red-large", "Red Large", ["value-red", "value-large"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-red-large",
          skuCode: "RC-RL",
          price: 1499,
          availableInventory: 0,
        }),
      ],
    });

    const offers = findProductNode(buildProductJsonLd(product, null))
      .offers as Record<string, unknown>[];

    expect(offers[0]).toMatchObject({
      "@type": "Offer",
      sku: "RC-RS",
      price: 1299,
      priceCurrency: "PHP",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      url: `${SITE_URL}/products/rattan-chair?variant=variant-red-small`,
      description: "Color: Red · Size: Small",
    });
    expect(offers[1]).toMatchObject({
      availability: "https://schema.org/OutOfStock",
      url: `${SITE_URL}/products/rattan-chair?variant=variant-red-large`,
      description: "Color: Red · Size: Large",
    });
  });

  it("falls back to the variant name when option labels cannot be resolved", () => {
    const product = productFixture({
      options: [],
      variants: [
        variant("variant-solo", "Rattan Chair — Natural", [], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-solo",
          skuCode: "RC-S",
        }),
      ],
    });

    const offers = findProductNode(buildProductJsonLd(product, null))
      .offers as Record<string, unknown>[];
    expect(offers[0].description).toBe("Rattan Chair — Natural");
  });

  it("keeps the Product node on the queryless canonical URL", () => {
    const product = productFixture({
      variants: [
        variant("variant-red-small", "Red Small", ["value-red", "value-small"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-red-small",
          skuCode: "RC-RS",
        }),
      ],
    });

    const node = findProductNode(buildProductJsonLd(product, null));
    expect(node.url).toBe(`${SITE_URL}/products/rattan-chair`);
    expect(String(node.url)).not.toContain("?");
    // Offer URLs are the only place the variant identity appears.
    const offers = node.offers as Record<string, unknown>[];
    expect(offers.every((offer) => String(offer.url).includes("?variant="))).toBe(
      true,
    );
  });

  it("omits offers entirely when no ACTIVE priced SKU exists", () => {
    const product = productFixture({
      variants: [
        variant("variant-x", "X", ["value-red", "value-small"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-x",
          skuCode: "RC-X",
          price: null,
        }),
      ],
    });

    const node = findProductNode(buildProductJsonLd(product, null));
    expect(node.offers).toBeUndefined();
  });

  it("keeps the breadcrumb graph alongside the product node", () => {
    const product = productFixture({
      variants: [
        variant("variant-red-small", "Red Small", ["value-red", "value-small"], {
          ...skuFixture({ status: "ACTIVE" }),
          id: "sku-red-small",
          skuCode: "RC-RS",
        }),
      ],
    });
    const graph = buildProductJsonLd(product, [
      { name: "Living Room", slug: "living-room" },
    ]) as { "@graph": { "@type": string }[] };

    expect(graph["@graph"].map((node) => node["@type"])).toEqual([
      "Product",
      "BreadcrumbList",
    ]);
    const crumbs = graph["@graph"][1] as unknown as {
      itemListElement: { item: string }[];
    };
    expect(crumbs.itemListElement[1].item).toBe(
      `${SITE_URL}/categories/living-room`,
    );
    // Breadcrumbs never encode the variant query either.
    expect(
      crumbs.itemListElement.every((crumb) => !crumb.item.includes("?")),
    ).toBe(true);
  });
});
