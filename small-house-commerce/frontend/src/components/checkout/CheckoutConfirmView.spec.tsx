import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CartItem, Product } from "@/lib/api";
import { CheckoutConfirmView } from "./CheckoutConfirmView";

/**
 * Confirmation-step contract tests (plan Task 18): checkout lines render
 * their structured option pairs and enriched thumbnail, and selections that
 * never resolved to real, available SKUs are blocked from confirmation —
 * the same dead ends the form page enforces, mirrored before PLACE COD
 * ORDER can fire. The hook runs for real; only the module boundaries
 * (api client, cart context, router, draft storage) are mocked.
 */

const apiMock = vi.hoisted(() => ({
  getProductBySlug: vi.fn(),
  createOrder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));

const useCartMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/cart/CartContext", () => ({ useCart: useCartMock }));

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const draftMock = vi.hoisted(() => ({
  readCheckoutDraft: vi.fn(),
  clearCheckoutDraft: vi.fn(),
}));
vi.mock("@/lib/checkoutDraft", () => draftMock);

const cover = {
  id: "cover",
  url: "/cover.jpg",
  type: "IMAGE" as const,
  altText: "Cover",
  sortOrder: 0,
};

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

const validDraft = {
  customer: {
    name: "Juan Dela Cruz",
    phone: "0917 123 4567",
    province: "Metro Manila",
    city: "Quezon City",
    barangay: "Diliman",
    postalCode: "1100",
    streetAddress: "123 Test Street",
    landmark: "",
  },
  savedAt: "2026-09-22T00:00:00.000Z",
  preferredDeliveryDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useCartMock.mockReturnValue({
    removeItems: vi.fn().mockResolvedValue(undefined),
  });
  draftMock.readCheckoutDraft.mockReturnValue(validDraft);
});

describe("CheckoutConfirmView", () => {
  it("blocks confirmation when the Buy Now skuId matches no variant of its product", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    render(<CheckoutConfirmView skuId="sku-unknown" qty="1" slug="chair" />);

    expect(await screen.findByText("We couldn't confirm this order.")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-place-order")).toBeNull();
    // A dead end stays put — it must not bounce to the form page.
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("blocks confirmation when the cart selection contains unavailable items", async () => {
    useCartMock.mockReturnValue({
      cart: { items: [item({ unavailable: true })] },
      loading: false,
      removeItems: vi.fn().mockResolvedValue(undefined),
    });
    render(<CheckoutConfirmView itemsParam="item-1" />);

    expect(await screen.findByText("We couldn't confirm this order.")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-place-order")).toBeNull();
  });

  it("renders the confirm UI with the resolved Buy Now selection", async () => {
    apiMock.getProductBySlug.mockResolvedValue(product);
    render(<CheckoutConfirmView skuId="sku-red-small" qty="2" slug="chair" />);

    expect(await screen.findByText("Confirm your order")).toBeInTheDocument();
    // Structured option pairs from the product graph, the enriched cover
    // thumbnail, and an enabled PLACE COD ORDER.
    expect(screen.getByTestId("confirm-items")).toHaveTextContent("Chair");
    expect(screen.getByTestId("confirm-items")).toHaveTextContent("Color: Red · Size: Small");
    expect(screen.getByTestId("confirm-items")).toHaveTextContent("Qty 2");
    expect(screen.getByAltText("Cover")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-place-order")).toBeEnabled();
  });
});
