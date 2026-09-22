import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "@/lib/api";
import { PlpProductCard } from "./PlpProductCard";

/**
 * PLP card contract tests (Task 14): cards render the backend's
 * effectiveCoverMedia and shared-selection price presentation — never a
 * positionally-picked images[0]/variants[0] — and single-SKU products add
 * directly (including out-of-stock save-for-later) while multi-SKU products
 * open the picker without adding anything.
 */

const cart = vi.hoisted(() => ({ addItem: vi.fn(), openPicker: vi.fn() }));
const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/categories/dining-living",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/tracking", () => ({
  track: tracking.track,
  trackCustom: tracking.trackCustom,
}));
vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ addItem: cart.addItem, openPicker: cart.openPicker }),
}));

const cover = {
  id: "cover",
  url: "/cover.jpg",
  type: "IMAGE" as const,
  altText: "Cover",
  sortOrder: 0,
};
const legacyImage = {
  id: "img-legacy",
  url: "/legacy-first.jpg",
  type: "IMAGE" as const,
  altText: "Legacy first",
  sortOrder: 0,
};

function buildProduct(overrides: Partial<Product>): Product {
  return {
    id: "product-1",
    name: "Oak Side Table",
    slug: "oak-side-table",
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
    options: [],
    defaultDisplayVariantId: null,
    effectiveCoverMedia: cover,
    images: [legacyImage],
    variants: [],
    ...overrides,
  };
}

function bridgeStyleOption(variantNames: string[]): StorefrontProductOption {
  return {
    id: "style-opt",
    kind: "STYLE",
    name: "Style",
    position: 0,
    presentation: "TEXT",
    isMediaDriver: false,
    values: variantNames.map((label, index) => ({
      id: `style-val-${index + 1}`,
      label,
      position: index,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
    })),
  };
}

function singleVariant(skuOverrides: {
  price?: number | null;
  compareAtPrice?: number | null;
  availableInventory?: number;
  status?: "ACTIVE" | "DISABLED";
}): StorefrontProductVariant {
  return {
    id: "v-single",
    name: "Oak",
    position: 0,
    combinationKey: "style-opt:style-val-1",
    optionValueIds: ["style-val-1"],
    sku: {
      id: "sku-single",
      skuCode: "OAK-SINGLE",
      status: skuOverrides.status ?? "ACTIVE",
      price: skuOverrides.price ?? 100,
      compareAtPrice: skuOverrides.compareAtPrice ?? 130,
      availableInventory: skuOverrides.availableInventory ?? 4,
    },
  };
}

const colorOption: StorefrontProductOption = {
  id: "color",
  kind: "COLOR",
  name: "Color",
  position: 0,
  presentation: "SWATCH",
  isMediaDriver: true,
  values: [
    {
      id: "red",
      label: "Red",
      position: 0,
      swatchHex: "#ff0000",
      thumbnailUrl: "/red-thumb.jpg",
      thumbnailAlt: "Red fabric",
    },
    {
      id: "blue",
      label: "Blue",
      position: 1,
      swatchHex: "#0000ff",
      thumbnailUrl: "/blue-thumb.jpg",
      thumbnailAlt: "Blue fabric",
    },
  ],
};

const sizeOption: StorefrontProductOption = {
  id: "size",
  kind: "SIZE",
  name: "Size",
  position: 1,
  presentation: "TEXT",
  isMediaDriver: false,
  values: [
    {
      id: "small",
      label: "Small",
      position: 0,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
    },
    {
      id: "large",
      label: "Large",
      position: 1,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
    },
  ],
};

function multiSkuVariant(
  id: string,
  name: string,
  position: number,
  combinationKey: string,
  optionValueIds: string[],
  sku: StorefrontProductVariant["sku"],
): StorefrontProductVariant {
  return { id, name, position, combinationKey, optionValueIds, sku };
}

const multiSkuProduct = buildProduct({
  options: [colorOption, sizeOption],
  variants: [
    multiSkuVariant("red-small", "Red / Small", 0, "color:red|size:small", [
      "red",
      "small",
    ], {
      id: "sku-red-small",
      skuCode: "RED-SMALL",
      status: "ACTIVE",
      price: 100,
      compareAtPrice: 130,
      availableInventory: 4,
    }),
    multiSkuVariant("red-large", "Red / Large", 1, "color:red|size:large", [
      "red",
      "large",
    ], {
      id: "sku-red-large",
      skuCode: "RED-LARGE",
      status: "ACTIVE",
      price: 110,
      compareAtPrice: null,
      availableInventory: 0,
    }),
    multiSkuVariant("blue-large", "Blue / Large", 2, "color:blue|size:large", [
      "blue",
      "large",
    ], {
      id: "sku-blue-large",
      skuCode: "BLUE-LARGE",
      status: "ACTIVE",
      price: 120,
      compareAtPrice: null,
      availableInventory: 2,
    }),
  ],
  defaultDisplayVariantId: "red-small",
});

const singleSkuProduct = buildProduct({
  options: [bridgeStyleOption(["Oak"])],
  variants: [singleVariant({})],
  defaultDisplayVariantId: "v-single",
});

const singleSkuOosProduct = buildProduct({
  options: [bridgeStyleOption(["Oak"])],
  variants: [singleVariant({ availableInventory: 0 })],
  defaultDisplayVariantId: "v-single",
});

const noSellableProduct = buildProduct({
  options: [bridgeStyleOption(["Oak"])],
  variants: [singleVariant({ status: "DISABLED" })],
  defaultDisplayVariantId: "v-single",
});

describe("PlpProductCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cart.addItem.mockResolvedValue(undefined);
  });

  it("renders the effective cover media instead of the first legacy image", () => {
    render(<PlpProductCard product={singleSkuProduct} badges={[]} />);

    expect(screen.getByAltText("Cover")).toHaveAttribute("src", "/cover.jpg");
    expect(screen.queryByAltText("Legacy first")).toBeNull();
  });

  it("shows the single sellable SKU's exact price and compare-at price", () => {
    render(<PlpProductCard product={singleSkuProduct} badges={[]} />);

    expect(screen.getByTestId("price")).toHaveTextContent("₱100.00");
    expect(screen.getByText("₱130.00")).toBeInTheDocument();
  });

  it("shows From and the lowest price when sellable SKUs differ in price", () => {
    render(<PlpProductCard product={multiSkuProduct} badges={[]} />);

    expect(screen.getByTestId("price")).toHaveTextContent("From ₱100.00");
  });

  it("adds the single SKU directly and fires exactly one AddToCart event", async () => {
    const user = userEvent.setup();
    render(<PlpProductCard product={singleSkuProduct} badges={[]} />);

    await user.click(screen.getByTestId("plp-add-oak-side-table"));

    await waitFor(() => expect(cart.addItem).toHaveBeenCalledTimes(1));
    expect(cart.addItem).toHaveBeenCalledWith({
      skuId: "sku-single",
      quantity: 1,
    });
    await waitFor(() => expect(tracking.track).toHaveBeenCalledTimes(1));
    expect(tracking.track).toHaveBeenCalledWith(
      "AddToCart",
      expect.objectContaining({ content_ids: ["sku-single"] }),
    );
  });

  it("still saves an out-of-stock single SKU to the cart", async () => {
    const user = userEvent.setup();
    render(<PlpProductCard product={singleSkuOosProduct} badges={[]} />);

    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
    const button = screen.getByTestId("plp-add-oak-side-table");
    expect(button).toBeEnabled();

    await user.click(button);

    await waitFor(() => expect(cart.addItem).toHaveBeenCalledTimes(1));
    expect(cart.addItem).toHaveBeenCalledWith({
      skuId: "sku-single",
      quantity: 1,
    });
    await waitFor(() => expect(tracking.track).toHaveBeenCalledTimes(1));
  });

  it("opens the picker for multi-SKU products without adding", async () => {
    const user = userEvent.setup();
    render(<PlpProductCard product={multiSkuProduct} badges={[]} />);

    await user.click(screen.getByTestId("plp-add-oak-side-table"));

    expect(cart.openPicker).toHaveBeenCalledTimes(1);
    expect(cart.openPicker).toHaveBeenCalledWith(multiSkuProduct);
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalled();
  });

  it("links to details when no sellable SKU exists", () => {
    render(<PlpProductCard product={noSellableProduct} badges={[]} />);

    expect(
      screen.queryByTestId("plp-add-oak-side-table"),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "View Details" })).toHaveAttribute(
      "href",
      "/products/oak-side-table",
    );
    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
  });
});
