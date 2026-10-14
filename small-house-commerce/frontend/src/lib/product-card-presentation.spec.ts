import { describe, expect, it } from "vitest";
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "./api";
import { cardInitialVariantId, cardMediaForSelection, cardPricePresentation } from "./product-card-presentation";
import {
  createInitialSelection,
  resolveSelection,
} from "./product-selection";

/**
 * Final review fix wave: pins the uniform-price branch of
 * cardPricePresentation (DESIGN §10.1) — an unresolved selection across a
 * multi-SKU product where every sellable SKU shares one price shows that
 * exact price, and the compare-at price only when the default display
 * variant actually sells at that same price.
 */

function option(
  id: string,
  values: { id: string; label: string }[],
): StorefrontProductOption {
  return {
    id,
    kind: id === "color" ? "COLOR" : "SIZE",
    name: id === "color" ? "Color" : "Size",
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
  optionValueIds: string[],
  sku: StorefrontProductVariant["sku"],
): StorefrontProductVariant {
  return {
    id,
    name: id,
    position: 0,
    combinationKey: `color:${optionValueIds[0]}|size:${optionValueIds[1]}`,
    optionValueIds,
    sku,
  };
}

function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Rattan Stool",
    slug: "rattan-stool",
    description: null,
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
    catalogGraphVersion: 2,
    options: [
      option("color", [{ id: "red", label: "Red" }, { id: "blue", label: "Blue" }]),
      option("size", [{ id: "small", label: "Small" }, { id: "large", label: "Large" }]),
    ],
    defaultDisplayVariantId: null,
    effectiveCoverMedia: null,
    images: [],
    variants: [],
    ...overrides,
  };
}

function derivedFor(product: Product) {
  // Two+ sellable SKUs keep the initial selection unresolved, which is the
  // precondition for the uniform-price branch.
  const derived = resolveSelection(product, createInitialSelection(product));
  expect(derived.resolvedVariant).toBeNull();
  return derived;
}

describe("cardPricePresentation uniform-price branch", () => {
  const redSmall = variant("variant-red-small", ["red", "small"], {
    id: "sku-red-small",
    skuCode: "RS",
    status: "ACTIVE",
    price: 100,
    compareAtPrice: 150,
    availableInventory: 4,
  });
  const redLarge = variant("variant-red-large", ["red", "large"], {
    id: "sku-red-large",
    skuCode: "RL",
    status: "ACTIVE",
    price: 100,
    compareAtPrice: null,
    availableInventory: 4,
  });

  it("shows the shared price with the display variant's compare-at price", () => {
    const product = productFixture({
      variants: [redSmall, redLarge],
      defaultDisplayVariantId: "variant-red-small",
    });

    expect(cardPricePresentation(derivedFor(product))).toEqual({
      kind: "exact",
      price: 100,
      compareAtPrice: 150,
      discountPercent: 33,
    });
  });

  it("suppresses the compare-at price when the display variant does not sell at the shared price", () => {
    const product = productFixture({
      variants: [
        redSmall,
        redLarge,
        // Unpriced → not sellable → excluded from the shared-price set, but
        // still the default display variant; its compare-at must not leak.
        variant("variant-blue-small", ["blue", "small"], {
          id: "sku-blue-small",
          skuCode: "BS",
          status: "ACTIVE",
          price: null,
          compareAtPrice: 200,
          availableInventory: 0,
        }),
      ],
      defaultDisplayVariantId: "variant-blue-small",
    });

    expect(cardPricePresentation(derivedFor(product))).toEqual({
      kind: "exact",
      price: 100,
      compareAtPrice: null,
      discountPercent: null,
    });
  });
});

describe("card defaults and media selection", () => {
  function mediaProduct(): Product {
    const product = productFixture({
      defaultDisplayVariantId: "red-small",
      images: [{ id: "shared", url: "/shared.webp", type: "IMAGE", altText: null, sortOrder: 0 }],
      variants: [
        variant("red-small", ["red", "small"], { id: "sku-red", skuCode: "RED", status: "ACTIVE", price: 100, compareAtPrice: 150, availableInventory: 4 }),
        variant("blue-large", ["blue", "large"], { id: "sku-blue", skuCode: "BLUE", status: "ACTIVE", price: 120, compareAtPrice: 180, availableInventory: 0 }),
      ],
      cardMedia: {
        displayVariantId: "red-small",
        unselected: {
          cover: { id: "red-cover", url: "/red.webp", type: "IMAGE", altText: "Red", sortOrder: 0 },
          scene: { id: "red-scene", url: "/red-scene.webp", type: "IMAGE", altText: "Red room", sortOrder: 1 },
        },
        variants: [
          { variantId: "red-small", cover: { id: "red-cover", url: "/red.webp", type: "IMAGE", altText: "Red", sortOrder: 0 }, scene: null },
          { variantId: "blue-large", cover: { id: "blue-cover", url: "/blue.webp", type: "IMAGE", altText: "Blue", sortOrder: 0 },
            scene: { id: "blue-scene", url: "/blue-scene.webp", type: "IMAGE", altText: "Blue room", sortOrder: 1 } },
        ],
      },
    });
    product.options[0]!.isMediaDriver = true;
    Object.assign(product.options[0]!.values[1]!, { thumbnailUrl: "/blue-thumb.webp", thumbnailAlt: "Blue thumbnail" });
    return product;
  }

  it("uses the explicit card default independently of the inferred PDP default", () => {
    const product = mediaProduct();
    product.defaultDisplayVariantId = "blue-large";
    expect(cardInitialVariantId(product)).toBe("red-small");
    product.cardMedia!.displayVariantId = "blue-large";
    expect(cardInitialVariantId(product)).toBe("blue-large");
  });

  it.each([null, "unknown"])("does not pick a default when the card display id is %s", defaultId => {
    const product = mediaProduct();
    product.cardMedia!.displayVariantId = defaultId;
    expect(cardInitialVariantId(product)).toBeNull();
  });

  it.each(["DISABLED", "unpriced", "missing"])("does not preselect a %s default SKU", kind => {
    const product = mediaProduct();
    if (kind === "missing") product.variants[0]!.sku = null;
    else if (kind === "unpriced") product.variants[0]!.sku!.price = null;
    else product.variants[0]!.sku!.status = "DISABLED";
    expect(cardInitialVariantId(product)).toBeNull();
  });

  it("accepts zero-priced defaults and leaves automatic single-SKU resolution to the provider", () => {
    const product = mediaProduct();
    product.variants[0]!.sku!.price = 0;
    expect(cardInitialVariantId(product)).toBe("red-small");
    product.defaultDisplayVariantId = null;
    product.cardMedia!.displayVariantId = null;
    product.variants = [product.variants[0]!];
    expect(cardInitialVariantId(product)).toBeNull();
    expect(resolveSelection(product, createInitialSelection(product)).resolvedVariant?.id).toBe("red-small");
  });

  it("uses the resolved variant pair instead of the default color", () => {
    const pair = cardMediaForSelection(mediaProduct(), "blue-large", { color: "blue", size: "large" });
    expect([pair.cover?.id, pair.scene?.id]).toEqual(["blue-cover", "blue-scene"]);
  });

  it("keeps an explicitly empty resolved pair as a placeholder", () => {
    const product = mediaProduct();
    product.cardMedia!.variants[1] = { variantId: "blue-large", cover: null, scene: null };
    expect(cardMediaForSelection(product, "blue-large", { color: "blue", size: "large" }))
      .toEqual({ cover: null, scene: null });
  });

  it("uses the unselected projection only before any option is selected", () => {
    const pair = cardMediaForSelection(mediaProduct(), null, {});
    expect([pair.cover?.id, pair.scene?.id]).toEqual(["red-cover", "red-scene"]);
  });

  it.each<Readonly<Record<string, string>>>([{ color: "blue" }, { size: "large" }])("uses a placeholder for an incomplete selection %j without borrowing thumbnails or gallery media", selection => {
    expect(cardMediaForSelection(mediaProduct(), null, selection)).toEqual({ cover: null, scene: null });
  });

  it("does not borrow another scope when the resolved variant has no card projection", () => {
    const product = mediaProduct();
    product.cardMedia!.variants = [];
    expect(cardMediaForSelection(product, "blue-large", { color: "blue", size: "large" }))
      .toEqual({ cover: null, scene: null });
  });

  it("does not borrow shared media even when the selected driver has no thumbnail", () => {
    const product = mediaProduct();
    product.options[0]!.values[1]!.thumbnailUrl = null;
    expect(cardMediaForSelection(product, null, { color: "blue" })).toEqual({ cover: null, scene: null });
  });

  it("ignores old cached effective covers and inferred defaults when cardMedia is absent", () => {
    const product = mediaProduct();
    delete product.cardMedia;
    product.effectiveCoverMedia = { id: "effective", url: "/effective.webp", type: "IMAGE", altText: null, sortOrder: 0 };
    expect(cardInitialVariantId(product)).toBeNull();
    expect(cardMediaForSelection(product, null, {})).toEqual({ cover: null, scene: null });
    expect(cardMediaForSelection(product, "blue-large", { color: "blue", size: "large" })).toEqual({ cover: null, scene: null });
  });

  it("never uses a gallery video or image in a missing card configuration", () => {
    const product = mediaProduct();
    delete product.cardMedia;
    const video = { id: "video", url: "/video.mp4", type: "VIDEO" as const, altText: null, sortOrder: 0 };
    product.effectiveCoverMedia = video;
    product.images.unshift(video);
    expect(cardMediaForSelection(product, null, {})).toEqual({ cover: null, scene: null });
  });
});

describe("cardPricePresentation discount percent", () => {
  /** A single sellable SKU auto-resolves, which is the exact-price branch. */
  function exactProduct(
    price: number,
    compareAtPrice: number | null,
  ): ReturnType<typeof cardPricePresentation> {
    const product = productFixture({
      variants: [
        variant("variant-red-small", ["red", "small"], {
          id: "sku-red-small",
          skuCode: "RS",
          status: "ACTIVE",
          price,
          compareAtPrice,
          availableInventory: 4,
        }),
      ],
    });
    const derived = resolveSelection(product, createInitialSelection(product));
    expect(derived.resolvedVariant).not.toBeNull();
    return cardPricePresentation(derived);
  }

  it("derives the integer percent off from a strictly higher compare-at price", () => {
    expect(exactProduct(100, 125)?.discountPercent).toBe(20);
  });

  it("rounds the percent to the nearest integer", () => {
    expect(exactProduct(100, 130)?.discountPercent).toBe(23); // 23.07…%
    expect(exactProduct(100, 126)?.discountPercent).toBe(21); // 20.63…%
  });

  it("ignores an equal, lower, or absent compare-at price", () => {
    expect(exactProduct(100, 100)?.discountPercent).toBeNull();
    expect(exactProduct(100, 80)?.discountPercent).toBeNull();
    expect(exactProduct(100, null)?.discountPercent).toBeNull();
  });

  it("ignores non-positive and malformed inputs", () => {
    expect(exactProduct(100, 0)?.discountPercent).toBeNull();
    expect(exactProduct(100, -50)?.discountPercent).toBeNull();
    expect(exactProduct(0, 100)?.discountPercent).toBeNull();
    expect(exactProduct(100, Number.NaN)?.discountPercent).toBeNull();
    expect(exactProduct(100, Number.POSITIVE_INFINITY)?.discountPercent).toBeNull();
  });

  it("suppresses a discount that would round to zero percent", () => {
    expect(exactProduct(1000, 1001)?.discountPercent).toBeNull();
  });

  it("caps the percent at 99 so a paid product never claims 100% off", () => {
    // 99.5% (price 50, compare-at 10,000) rounds to 100; the chip must cap
    // at 99 — a non-free product can never honestly be "100% OFF".
    expect(exactProduct(50, 10000)?.discountPercent).toBe(99);
    // The rounding still applies below the cap: 99.49…% → 99.
    expect(exactProduct(100, 19900)?.discountPercent).toBe(99);
  });

  it("never derives a discount on a From price", () => {
    const product = productFixture({
      variants: [
        variant("variant-red-small", ["red", "small"], {
          id: "sku-red-small",
          skuCode: "RS",
          status: "ACTIVE",
          price: 100,
          compareAtPrice: 150,
          availableInventory: 4,
        }),
        variant("variant-red-large", ["red", "large"], {
          id: "sku-red-large",
          skuCode: "RL",
          status: "ACTIVE",
          price: 120,
          compareAtPrice: null,
          availableInventory: 4,
        }),
      ],
    });

    expect(cardPricePresentation(derivedFor(product))).toMatchObject({
      kind: "from",
      discountPercent: null,
    });
  });
});
