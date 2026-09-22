import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { CartItem, Product } from "@/lib/api";
import {
  buyNowLineOptions,
  buyNowThumbnail,
  cartLineOptions,
} from "./checkoutItems";
import { useCheckoutLines } from "./useCheckoutLines";

/**
 * Checkout display model (plan Task 18): every checkout line shows its
 * structured option pairs and an enriched thumbnail (cart lines carry the
 * backend-enriched summary data; Buy Now resolves from the product payload),
 * while the order request itself remains exactly `{skuId, quantity}` — the
 * backend's order-time snapshot stays the single source of truth.
 */

const apiMock = vi.hoisted(() => ({ getProductBySlug: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

const useCartMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/cart/CartContext", () => ({ useCart: useCartMock }));

const cover = {
  id: "cover",
  url: "/cover.jpg",
  type: "IMAGE" as const,
  altText: "Cover",
  sortOrder: 0,
};

// Array order is deliberately the REVERSE of the option positions so the
// builder proves it sorts by option position (the backend's display order).
const product: Product = {
  id: "product-1",
  name: "Chair",
  slug: "chair",
  description: null,
  tagline: null,
  categoryId: "category-1",
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
  catalogGraphVersion: 7,
  options: [
    {
      id: "size",
      kind: "SIZE",
      name: "Size",
      position: 1,
      presentation: "TEXT",
      isMediaDriver: false,
      values: [
        { id: "small", label: "Small", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        { id: "large", label: "Large", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
      ],
    },
    {
      id: "color",
      kind: "COLOR",
      name: "Color",
      position: 0,
      presentation: "SWATCH",
      isMediaDriver: true,
      values: [
        { id: "red", label: "Red", position: 0, swatchHex: "#ff0000", thumbnailUrl: "/red-thumb.jpg", thumbnailAlt: "Red fabric" },
        { id: "blue", label: "Blue", position: 1, swatchHex: "#0000ff", thumbnailUrl: null, thumbnailAlt: null },
      ],
    },
  ],
  defaultDisplayVariantId: "red-small",
  effectiveCoverMedia: cover,
  images: [],
  variants: [
    {
      id: "red-small",
      name: "Red / Small",
      position: 0,
      combinationKey: "color:red|size:small",
      optionValueIds: ["red", "small"],
      sku: {
        id: "sku-red-small",
        skuCode: "RED-SMALL",
        status: "ACTIVE",
        price: 100,
        compareAtPrice: 130,
        availableInventory: 4,
      },
    },
  ],
};

const productWithoutOptions: Product = {
  ...product,
  options: [],
  variants: [
    {
      id: "v1",
      name: "Default",
      position: 0,
      combinationKey: "v1",
      optionValueIds: [],
      sku: {
        id: "sku-1",
        skuCode: "SKU-1",
        status: "ACTIVE",
        price: 100,
        compareAtPrice: null,
        availableInventory: 4,
      },
    },
  ],
};

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    itemId: "item-1",
    skuId: "sku-red-small",
    skuCode: "RED-SMALL",
    productName: "Chair",
    productSlug: "chair",
    variantName: "Red / Small",
    quantity: 1,
    unitPrice: 100,
    compareAtPrice: 130,
    lineTotal: 100,
    availableInventory: 4,
    unavailable: false,
    optionValues: [
      { optionId: "color", optionName: "Color", optionValueId: "red", label: "Red" },
      { optionId: "size", optionName: "Size", optionValueId: "small", label: "Small" },
    ],
    thumbnail: {
      url: "/red-thumb.jpg",
      type: "IMAGE",
      altText: "Red chair",
      resolvedScope: "OPTION_VALUE",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartMock.mockReturnValue({ cart: null, loading: false });
});

describe("cartLineOptions", () => {
  it("maps the enriched option values to display pairs in backend order", () => {
    expect(cartLineOptions(item())).toEqual([
      { label: "Color", value: "Red" },
      { label: "Size", value: "Small" },
    ]);
  });

  it("returns no pairs for legacy rows (empty optionValues)", () => {
    expect(cartLineOptions(item({ optionValues: [] }))).toEqual([]);
  });
});

describe("buyNowLineOptions", () => {
  it("resolves the requested SKU's pairs ordered by option position (not array order)", () => {
    expect(buyNowLineOptions(product, "sku-red-small")).toEqual([
      { label: "Color", value: "Red" },
      { label: "Size", value: "Small" },
    ]);
  });

  it("returns no pairs when the skuId matches no variant of the product", () => {
    expect(buyNowLineOptions(product, "sku-unknown")).toEqual([]);
  });

  it("returns no pairs for products without a typed option graph", () => {
    expect(buyNowLineOptions(productWithoutOptions, "sku-1")).toEqual([]);
  });
});

describe("buyNowThumbnail", () => {
  it("maps the product's effective cover media", () => {
    expect(buyNowThumbnail(product)).toEqual({
      url: "/cover.jpg",
      type: "IMAGE",
      altText: "Cover",
    });
  });

  it("is null when the product has no cover media", () => {
    expect(buyNowThumbnail({ ...product, effectiveCoverMedia: null })).toBeNull();
  });

  it("passes VIDEO covers through so the slot can render them", () => {
    const videoCover = { ...cover, type: "VIDEO" as const, url: "/cover.mp4" };
    expect(buyNowThumbnail({ ...product, effectiveCoverMedia: videoCover })).toEqual({
      url: "/cover.mp4",
      type: "VIDEO",
      altText: "Cover",
    });
  });
});

describe("useCheckoutLines", () => {
  it("cart lines carry the enriched option pairs and thumbnail; the request stays {skuId, quantity}", () => {
    useCartMock.mockReturnValue({ cart: { items: [item()] }, loading: false });
    const { result } = renderHook(() =>
      useCheckoutLines({ itemsParam: "item-1" }),
    );
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].options).toEqual([
      { label: "Color", value: "Red" },
      { label: "Size", value: "Small" },
    ]);
    expect(result.current.lines[0].thumbnail).toEqual({
      url: "/red-thumb.jpg",
      type: "IMAGE",
      altText: "Red chair",
    });
    expect(result.current.orderItems).toEqual([
      { skuId: "sku-red-small", quantity: 1 },
    ]);
  });

  it("legacy cart rows expose no pairs and no thumbnail (variant text remains the fallback)", () => {
    useCartMock.mockReturnValue({
      cart: {
        items: [item({ optionValues: [], thumbnail: null })],
      },
      loading: false,
    });
    const { result } = renderHook(() =>
      useCheckoutLines({ itemsParam: "item-1" }),
    );
    expect(result.current.lines[0].options).toEqual([]);
    expect(result.current.lines[0].thumbnail).toBeNull();
  });

  it("Buy Now resolves the selected options and cover thumbnail; the request stays {skuId, quantity}", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    const { result } = renderHook(() =>
      useCheckoutLines({ skuId: "sku-red-small", qty: "2", slug: "chair" }),
    );
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(result.current.lines[0].options).toEqual([
      { label: "Color", value: "Red" },
      { label: "Size", value: "Small" },
    ]);
    expect(result.current.lines[0].thumbnail).toEqual({
      url: "/cover.jpg",
      type: "IMAGE",
      altText: "Cover",
    });
    expect(result.current.orderItems).toEqual([
      { skuId: "sku-red-small", quantity: 2 },
    ]);
  });

  it("a DISABLED-sku deep link dead-ends instead of failing at backend submit", async () => {
    const disabledSkuProduct: Product = {
      ...product,
      variants: [
        {
          ...product.variants[0],
          sku: {
            id: "sku-red-small",
            skuCode: "RED-SMALL",
            status: "DISABLED",
            price: 100,
            compareAtPrice: 130,
            availableInventory: 4,
          },
        },
      ],
    };
    apiMock.getProductBySlug.mockResolvedValue(disabledSkuProduct);
    const { result } = renderHook(() =>
      useCheckoutLines({ skuId: "sku-red-small", qty: "1", slug: "chair" }),
    );
    await waitFor(() => expect(result.current.product).not.toBeNull());
    expect(result.current.buyNowMatchedSku).toBe(false);
    expect(result.current.ready).toBe(false);
  });
});
