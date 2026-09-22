import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartItem, CartSummary, Product } from "@/lib/api";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { CartView } from "./CartView";

/**
 * Cart page contract tests (Task 16): lines render the enriched summary's
 * structured option values, SKU, and thumbnail (IMAGE or VIDEO) — no
 * product-by-slug image recovery — and every line exposes an accessible
 * Change Options entry that opens the shared picker in the cart drawer. The
 * full flow rides the real CartProvider with the API client mocked: prefill
 * without confirmation, exactly one PATCH, merged response adoption,
 * server-error preservation/announcement, and focus restoration.
 */

const apiMock = vi.hoisted(() => ({
  getCart: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
  replaceCartItem: vi.fn(),
  getCollectionProducts: vi.fn(),
  getProducts: vi.fn(),
  getProductBySlug: vi.fn(),
}));
const cartStorageMock = vi.hoisted(() => ({
  get: vi.fn(() => "cart-1"),
  set: vi.fn(),
}));
const productCacheMock = vi.hoisted(() => ({ fetchProduct: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/cart",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  cartStorage: cartStorageMock,
}));
// The module-level productCache would otherwise leak warm entries between
// tests (the recommendations hook legitimately fetches line products for
// categoryId ranking), making the "no product fetch" assertion
// order-dependent. Mocking the cache isolates every test: fetchProduct
// resolves here without touching the API client, so the
// getProductBySlug assertion measures cart rendering deterministically.
vi.mock("@/lib/productCache", () => ({
  fetchProduct: productCacheMock.fetchProduct,
}));

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
    {
      id: "red-large",
      name: "Red / Large",
      position: 1,
      combinationKey: "color:red|size:large",
      optionValueIds: ["red", "large"],
      sku: {
        id: "sku-red-large",
        skuCode: "RED-LARGE",
        status: "ACTIVE",
        price: 110,
        compareAtPrice: null,
        availableInventory: 0,
      },
    },
    {
      id: "blue-large",
      name: "Blue / Large",
      position: 2,
      combinationKey: "color:blue|size:large",
      optionValueIds: ["blue", "large"],
      sku: {
        id: "sku-blue-large",
        skuCode: "BLUE-LARGE",
        status: "ACTIVE",
        price: 120,
        compareAtPrice: null,
        availableInventory: 5,
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

function summary(items: CartItem[]): CartSummary {
  return {
    cartId: "cart-1",
    expiresAt: "2026-12-31T00:00:00.000Z",
    items,
    subtotal: items.reduce((sum, line) => sum + line.lineTotal, 0),
    discount: 0,
    shipping: 0,
    total: items.reduce((sum, line) => sum + line.lineTotal, 0),
  };
}

function renderCart() {
  return render(
    <CartProvider>
      <CartView />
      <CartDrawer />
    </CartProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getCart.mockResolvedValue(summary([item()]));
  apiMock.updateCartItem.mockResolvedValue(summary([item()]));
  apiMock.removeCartItem.mockResolvedValue(summary([]));
  apiMock.replaceCartItem.mockResolvedValue(summary([item()]));
  apiMock.getCollectionProducts.mockResolvedValue({ items: [], total: 0 });
  apiMock.getProducts.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 24,
  });
  apiMock.getProductBySlug.mockResolvedValue(product);
  // The Change Options picker loads its product through the cache layer.
  productCacheMock.fetchProduct.mockResolvedValue(product);
});

describe("CartView structured lines", () => {
  it("shows structured Color/Size values and the SKU from the enriched summary", async () => {
    renderCart();

    expect(await screen.findByText("Chair")).toBeInTheDocument();
    expect(screen.getByTestId("line-options-item-1")).toHaveTextContent(
      "Color: Red · Size: Small · SKU: RED-SMALL",
    );
  });

  it("falls back to variantName for legacy lines without option values", async () => {
    apiMock.getCart.mockResolvedValue(
      summary([item({ optionValues: [] })]),
    );
    renderCart();

    expect(await screen.findByTestId("line-options-item-1")).toHaveTextContent(
      "Red / Small · SKU: RED-SMALL",
    );
  });

  it("renders the enriched IMAGE thumbnail without fetching the product for images", async () => {
    renderCart();

    await screen.findByText("Chair");
    const image = document.querySelector('img[src="/red-thumb.jpg"]');
    expect(image).not.toBeNull();
    expect(apiMock.getProductBySlug).not.toHaveBeenCalled();
  });

  it("renders a VIDEO thumbnail as a muted video element", async () => {
    apiMock.getCart.mockResolvedValue(
      summary([
        item({
          thumbnail: {
            url: "/red-clip.mp4",
            type: "VIDEO",
            altText: "Red chair clip",
            resolvedScope: "VARIANT",
          },
        }),
      ]),
    );
    renderCart();

    await screen.findByText("Chair");
    const video = document.querySelector('video[src="/red-clip.mp4"]');
    expect(video).not.toBeNull();
    expect(video).toHaveProperty("muted", true);
    expect(video).not.toHaveAttribute("autoplay");
  });
});

describe("CartView change options flow", () => {
  it("replaces the SKU with exactly one PATCH and adopts the merged response", async () => {
    // The backend merges into an existing blue-large line: source row gone,
    // target row quantity 1 + requested 1 = 2.
    apiMock.getCart.mockResolvedValue(
      summary([
        item(),
        item({
          itemId: "item-2",
          skuId: "sku-blue-large",
          skuCode: "BLUE-LARGE",
          productName: "Desk",
          productSlug: "desk",
          variantName: "Blue / Large",
          unitPrice: 120,
          lineTotal: 120,
          availableInventory: 5,
          optionValues: [
            { optionId: "color", optionName: "Color", optionValueId: "blue", label: "Blue" },
            { optionId: "size", optionName: "Size", optionValueId: "large", label: "Large" },
          ],
          thumbnail: {
            url: "/blue-thumb.jpg",
            type: "IMAGE",
            altText: "Blue desk",
            resolvedScope: "OPTION_VALUE",
          },
        }),
      ]),
    );
    apiMock.replaceCartItem.mockResolvedValue(
      summary([
        item({
          itemId: "item-2",
          skuId: "sku-blue-large",
          skuCode: "BLUE-LARGE",
          productName: "Desk",
          productSlug: "desk",
          variantName: "Blue / Large",
          quantity: 2,
          unitPrice: 120,
          lineTotal: 240,
          availableInventory: 5,
          optionValues: [
            { optionId: "color", optionName: "Color", optionValueId: "blue", label: "Blue" },
            { optionId: "size", optionName: "Size", optionValueId: "large", label: "Large" },
          ],
          thumbnail: {
            url: "/blue-thumb.jpg",
            type: "IMAGE",
            altText: "Blue desk",
            resolvedScope: "OPTION_VALUE",
          },
        }),
      ]),
    );
    const user = userEvent.setup();
    renderCart();

    await screen.findByText("Chair");
    await user.click(screen.getByRole("button", { name: "Change options for Chair" }));

    // The picker opens prefilled with the line's current options, no
    // confirmation step beforehand.
    const picker = await screen.findByRole("dialog", { name: "Change options" });
    const confirm = await within(picker).findByTestId("cart-picker-confirm");
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(within(picker).getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(picker).getByRole("button", { name: "Large" }));
    await user.click(within(picker).getByRole("button", { name: "Blue" }));
    await user.click(confirm);

    await waitFor(() =>
      expect(apiMock.replaceCartItem).toHaveBeenCalledTimes(1),
    );
    expect(apiMock.replaceCartItem).toHaveBeenCalledWith("cart-1", "item-1", {
      skuId: "sku-blue-large",
      quantity: 1,
    });

    // Merged response adopted: the Chair line is gone, the Desk line carries
    // the merged quantity.
    await waitFor(() =>
      expect(screen.queryByText("Chair")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("line-options-item-2"),
    ).toHaveTextContent("Color: Blue · Size: Large · SKU: BLUE-LARGE");
    expect(screen.getByLabelText("Quantity")).toHaveValue("2");
  });

  it("restores focus to the Change options trigger after the drawer closes", async () => {
    const user = userEvent.setup();
    renderCart();

    await screen.findByText("Chair");
    const trigger = screen.getByRole("button", {
      name: "Change options for Chair",
    });
    await user.click(trigger);

    const picker = await screen.findByRole("dialog", { name: "Change options" });
    const confirm = await within(picker).findByTestId("cart-picker-confirm");
    await waitFor(() => expect(confirm).toBeEnabled());

    // In-place adoption: the same row keeps its id, so the trigger survives.
    apiMock.replaceCartItem.mockResolvedValue(
      summary([
        item({
          skuId: "sku-blue-large",
          skuCode: "BLUE-LARGE",
          variantName: "Blue / Large",
          unitPrice: 120,
          lineTotal: 120,
          optionValues: [
            { optionId: "color", optionName: "Color", optionValueId: "blue", label: "Blue" },
            { optionId: "size", optionName: "Size", optionValueId: "large", label: "Large" },
          ],
          thumbnail: {
            url: "/blue-thumb.jpg",
            type: "IMAGE",
            altText: "Blue chair",
            resolvedScope: "OPTION_VALUE",
          },
        }),
      ]),
    );
    await user.click(within(picker).getByRole("button", { name: "Large" }));
    await user.click(within(picker).getByRole("button", { name: "Blue" }));
    await user.click(confirm);

    // The drawer swaps to the cart view and focus moves into its chrome.
    await waitFor(() =>
      expect(within(screen.getByRole("dialog", { name: "Your cart" })).getByText(/Color: Blue · Size: Large/)).toBeInTheDocument(),
    );
    // The header close button (not the backdrop) owns focus after the swap.
    const headerClose = screen
      .getAllByRole("button", { name: "Close cart" })
      .find((button) => button.closest("aside"));
    expect(headerClose).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("announces the server error and preserves the cart without a reload", async () => {
    apiMock.replaceCartItem.mockRejectedValueOnce(
      new Error("Target SKU is no longer available"),
    );
    const user = userEvent.setup();
    renderCart();

    await screen.findByText("Chair");
    await user.click(screen.getByRole("button", { name: "Change options for Chair" }));

    const picker = await screen.findByRole("dialog", { name: "Change options" });
    const confirm = await within(picker).findByTestId("cart-picker-confirm");
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    expect(
      await within(picker).findByTestId("cart-picker-error"),
    ).toHaveTextContent("Target SKU is no longer available");
    // Preservation: the cart state is untouched — no summary refetch.
    expect(apiMock.getCart).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("line-options-item-1"),
    ).toHaveTextContent("Color: Red · Size: Small · SKU: RED-SMALL");

    // Cancel is a no-op: back to the cart view, original line intact.
    await user.click(within(picker).getByTestId("cart-picker-cancel"));
    expect(
      screen.getByRole("dialog", { name: "Your cart" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("line-options-item-1"),
    ).toHaveTextContent("Color: Red · Size: Small · SKU: RED-SMALL");
  });
});
