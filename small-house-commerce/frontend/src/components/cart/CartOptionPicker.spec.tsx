import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartItem, Product } from "@/lib/api";
import { CartLineThumbnail, CartOptionPicker } from "./CartOptionPicker";

/**
 * Cart Change Options contract tests (Task 16): the picker reuses the shared
 * PdpPurchaseProvider/ProductOptionSelector pair, opens prefilled with the
 * line's current options WITHOUT a prior confirmation step, cancels as a
 * no-op, sends exactly one PATCH on confirm, adopts the merged response, and
 * announces server errors while preserving the cart. Line thumbnails render
 * the enriched summary media, including VIDEO urls.
 */

const cart = vi.hoisted(() => ({ replaceItem: vi.fn() }));
const productCache = vi.hoisted(() => ({ fetchProduct: vi.fn() }));

vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ replaceItem: cart.replaceItem }),
}));
vi.mock("@/lib/productCache", () => ({ fetchProduct: productCache.fetchProduct }));

const cover = {
  id: "cover",
  url: "/cover.jpg",
  type: "IMAGE" as const,
  altText: "Cover",
  sortOrder: 0,
};

function colorOption(): Product["options"][number] {
  return {
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
}

const sizeOption: Product["options"][number] = {
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
};

function variant(
  id: string,
  name: string,
  position: number,
  combinationKey: string,
  optionValueIds: string[],
  price: number,
  availableInventory: number,
): Product["variants"][number] {
  return {
    id,
    name,
    position,
    combinationKey,
    optionValueIds,
    sku: {
      id: `sku-${id}`,
      skuCode: id.toUpperCase(),
      status: "ACTIVE",
      price,
      compareAtPrice: id === "red-small" ? 130 : null,
      availableInventory,
    },
  };
}

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
  options: [colorOption(), sizeOption],
  defaultDisplayVariantId: "red-small",
  effectiveCoverMedia: cover,
  images: [],
  variants: [
    variant("red-small", "Red / Small", 0, "color:red|size:small", ["red", "small"], 100, 4),
    variant("red-large", "Red / Large", 1, "color:red|size:large", ["red", "large"], 110, 0),
    variant("blue-large", "Blue / Large", 2, "color:blue|size:large", ["blue", "large"], 120, 2),
  ],
};

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    itemId: "item-1",
    skuId: "sku-red-small",
    skuCode: "RED-SMALL",
    productName: "Chair",
    productSlug: "chair",
    variantName: "Red / Small",
    quantity: 2,
    unitPrice: 100,
    compareAtPrice: 130,
    lineTotal: 200,
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

function renderPicker(item: CartItem, onDone = vi.fn()) {
  const onDoneMock = onDone;
  render(<CartOptionPicker item={item} onDone={onDoneMock} />);
  return { onDoneMock };
}

describe("CartOptionPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productCache.fetchProduct.mockResolvedValue(product);
    cart.replaceItem.mockResolvedValue(undefined);
  });

  it("opens prefilled with the line's options and requires no prior confirmation", async () => {
    renderPicker(cartItem());

    // The prefilled combination resolves immediately: Confirm is enabled on
    // open and no PATCH fires until the visitor confirms.
    const confirm = await screen.findByTestId("cart-picker-confirm");
    expect(confirm).toBeEnabled();
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Small" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(cart.replaceItem).not.toHaveBeenCalled();
  });

  it("shows the line's structured summary, SKU, and enriched thumbnail", async () => {
    renderPicker(cartItem());

    expect(await screen.findByTestId("cart-picker-current")).toHaveTextContent(
      "Color: Red · Size: Small",
    );
    expect(screen.getByText("SKU: RED-SMALL")).toBeInTheDocument();
    const image = document.querySelector('img[src="/red-thumb.jpg"]');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("alt", "Red chair");
  });

  it("sends exactly one PATCH with the new SKU and the line quantity on confirm", async () => {
    const user = userEvent.setup();
    const { onDoneMock } = renderPicker(cartItem());

    // Large first (red-large exists), then Blue (blue-large exists) so both
    // values stay compatible with the prefilled selection.
    await screen.findByTestId("cart-picker-confirm");
    await user.click(screen.getByRole("button", { name: "Large" }));
    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByTestId("cart-picker-confirm"));

    await waitFor(() => expect(cart.replaceItem).toHaveBeenCalledTimes(1));
    expect(cart.replaceItem).toHaveBeenCalledWith({
      itemId: "item-1",
      skuId: "sku-blue-large",
      quantity: 2,
    });
    await waitFor(() => expect(onDoneMock).toHaveBeenCalledTimes(1));
  });

  it("confirms the unchanged combination with the line's own SKU and quantity", async () => {
    const user = userEvent.setup();
    const { onDoneMock } = renderPicker(cartItem());

    await screen.findByTestId("cart-picker-confirm");
    await user.click(screen.getByTestId("cart-picker-confirm"));

    await waitFor(() => expect(cart.replaceItem).toHaveBeenCalledTimes(1));
    expect(cart.replaceItem).toHaveBeenCalledWith({
      itemId: "item-1",
      skuId: "sku-red-small",
      quantity: 2,
    });
    expect(onDoneMock).toHaveBeenCalledTimes(1);
  });

  it("cancels as a no-op: no request, picker closes", async () => {
    const user = userEvent.setup();
    const { onDoneMock } = renderPicker(cartItem());

    await screen.findByTestId("cart-picker-confirm");
    await user.click(screen.getByTestId("cart-picker-cancel"));

    expect(cart.replaceItem).not.toHaveBeenCalled();
    expect(onDoneMock).toHaveBeenCalledTimes(1);
  });

  it("announces the server error, keeps the picker open, and preserves the flow", async () => {
    cart.replaceItem.mockRejectedValueOnce(
      new Error("Target SKU belongs to a different product"),
    );
    const user = userEvent.setup();
    const { onDoneMock } = renderPicker(cartItem());

    await screen.findByTestId("cart-picker-confirm");
    await user.click(screen.getByTestId("cart-picker-confirm"));

    expect(await screen.findByTestId("cart-picker-error")).toHaveTextContent(
      "Target SKU belongs to a different product",
    );
    expect(onDoneMock).not.toHaveBeenCalled();
    // The picker stays usable: Confirm re-enables for a retry.
    expect(screen.getByTestId("cart-picker-confirm")).toBeEnabled();
  });

  it("shows a loading state while the product payload is in flight", () => {
    productCache.fetchProduct.mockReturnValue(new Promise(() => undefined));
    renderPicker(cartItem());

    expect(screen.getByText("Loading options…")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-picker-confirm")).toBeNull();
  });

  it("offers a cancel escape hatch when the product payload cannot load", async () => {
    productCache.fetchProduct.mockResolvedValue(null);
    const user = userEvent.setup();
    const { onDoneMock } = renderPicker(cartItem());

    expect(
      await screen.findByText(/couldn't load the options/i),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("cart-picker-cancel"));
    expect(cart.replaceItem).not.toHaveBeenCalled();
    expect(onDoneMock).toHaveBeenCalledTimes(1);
  });
});

describe("CartLineThumbnail", () => {
  it("renders an IMAGE thumbnail as an img", () => {
    const { container } = render(<CartLineThumbnail item={cartItem()} />);
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "/red-thumb.jpg");
    expect(container.querySelector("video")).toBeNull();
  });

  it("renders a VIDEO thumbnail as a muted, non-autoplaying video element", () => {
    const { container } = render(
      <CartLineThumbnail
        item={cartItem({
          thumbnail: {
            url: "/red-clip.mp4",
            type: "VIDEO",
            altText: "Red chair clip",
            resolvedScope: "VARIANT",
          },
        })}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "/red-clip.mp4");
    // A cart line must never start playing audio or motion on its own.
    // React applies muted/playsInline as DOM properties, not attributes.
    expect(video).toHaveProperty("muted", true);
    expect(video).toHaveProperty("playsInline", true);
    expect(video).not.toHaveAttribute("autoplay");
  });

  it("falls back to the placeholder when the line has no thumbnail", () => {
    const { container } = render(
      <CartLineThumbnail
        item={cartItem({ thumbnail: null })}
        placeholderLabel="Chair"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent).toContain("Chair");
  });
});
