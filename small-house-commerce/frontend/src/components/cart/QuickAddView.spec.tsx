import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "@/lib/api";
import { QuickAddView } from "./QuickAddView";

/**
 * Quick Add picker contract tests (Task 14): the picker rides the shared
 * purchase provider (no default multi-SKU selection), renders IMAGE/SWATCH/
 * TEXT option controls, resolves media through the driver-value thumbnail
 * then the effective cover, and fires exactly one AddToCart event per
 * successful confirm — never on cancel or media browsing.
 */

const cart = vi.hoisted(() => ({ addItem: vi.fn() }));
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
  usePathname: () => "/products/chair",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/tracking", () => ({
  track: tracking.track,
  trackCustom: tracking.trackCustom,
}));
vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ addItem: cart.addItem }),
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

function colorOption(
  presentation: "SWATCH" | "IMAGE",
): StorefrontProductOption {
  return {
    id: "color",
    kind: "COLOR",
    name: "Color",
    position: 0,
    presentation,
    isMediaDriver: true,
    values: [
      {
        id: "red",
        label: "Red",
        position: 0,
        swatchHex: presentation === "SWATCH" ? "#ff0000" : null,
        thumbnailUrl: "/red-thumb.jpg",
        thumbnailAlt: "Red fabric",
      },
      {
        id: "blue",
        label: "Blue",
        position: 1,
        swatchHex: presentation === "SWATCH" ? "#0000ff" : null,
        thumbnailUrl: "/blue-thumb.jpg",
        thumbnailAlt: "Blue fabric",
      },
    ],
  };
}

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

function variant(
  id: string,
  name: string,
  position: number,
  combinationKey: string,
  optionValueIds: string[],
  price: number,
  availableInventory: number,
): StorefrontProductVariant {
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

function buildMultiSkuProduct(presentation: "SWATCH" | "IMAGE"): Product {
  return {
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
    options: [colorOption(presentation), sizeOption],
    defaultDisplayVariantId: "red-small",
    effectiveCoverMedia: cover,
    images: [legacyImage],
    variants: [
      variant("red-small", "Red / Small", 0, "color:red|size:small", [
        "red",
        "small",
      ], 100, 4),
      variant("red-large", "Red / Large", 1, "color:red|size:large", [
        "red",
        "large",
      ], 110, 0),
      variant("blue-large", "Blue / Large", 2, "color:blue|size:large", [
        "blue",
        "large",
      ], 120, 2),
    ],
  };
}

const swatchProduct = buildMultiSkuProduct("SWATCH");
const imageProduct = buildMultiSkuProduct("IMAGE");

async function selectOptions(
  user: ReturnType<typeof userEvent.setup>,
  labels: string[],
) {
  for (const label of labels) {
    await user.click(screen.getByRole("button", { name: label }));
  }
}

describe("QuickAddView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cart.addItem.mockResolvedValue(undefined);
  });

  it("does not preselect a SKU for multi-SKU products", () => {
    render(
      <QuickAddView
        product={swatchProduct}
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("picker-confirm-chair")).toBeDisabled();
    expect(screen.queryByText("Red / Small")).toBeNull();
    expect(screen.getByTestId("price")).toHaveTextContent("From ₱100.00");
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("shows the effective cover before any selection, not the first legacy image", () => {
    render(
      <QuickAddView
        product={swatchProduct}
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("picker-media-chair")).toHaveAttribute(
      "src",
      "/cover.jpg",
    );
    expect(screen.queryByAltText("Legacy first")).toBeNull();
  });

  it("renders IMAGE presentation values as image thumbnails", () => {
    render(
      <QuickAddView
        product={imageProduct}
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const red = screen.getByRole("button", { name: "Red" });
    const thumbnail = within(red).getByAltText("Red fabric");
    expect(thumbnail).toHaveAttribute("src", "/red-thumb.jpg");
  });

  it("renders SWATCH presentation values as color dots", () => {
    render(
      <QuickAddView
        product={swatchProduct}
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const red = screen.getByRole("button", { name: "Red" });
    const dot = red.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(dot?.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("renders TEXT presentation values as plain labels", () => {
    render(
      <QuickAddView
        product={swatchProduct}
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const large = screen.getByRole("button", { name: "Large" });
    expect(large.textContent).toBe("Large");
    expect(large.querySelector("img")).toBeNull();
    expect(large.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it("shows the driver-value thumbnail while browsing and fires no events", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickAddView product={swatchProduct} onAdded={onAdded} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Red" }));
    expect(screen.getByTestId("picker-media-chair")).toHaveAttribute(
      "src",
      "/red-thumb.jpg",
    );

    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(screen.getByTestId("picker-media-chair")).toHaveAttribute(
      "src",
      "/blue-thumb.jpg",
    );

    expect(tracking.track).not.toHaveBeenCalled();
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("keeps confirm disabled until a complete combination is selected", async () => {
    const user = userEvent.setup();
    render(
      <QuickAddView
        product={swatchProduct}
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Red" }));
    expect(screen.getByTestId("picker-confirm-chair")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Small" }));
    expect(screen.getByTestId("picker-confirm-chair")).toBeEnabled();
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("confirms exactly once and fires exactly one AddToCart event", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickAddView product={swatchProduct} onAdded={onAdded} onClose={onClose} />,
    );

    await selectOptions(user, ["Red", "Small"]);
    expect(screen.getByTestId("price")).toHaveTextContent("₱100.00");

    await user.click(screen.getByTestId("picker-confirm-chair"));

    await waitFor(() => expect(cart.addItem).toHaveBeenCalledTimes(1));
    expect(cart.addItem).toHaveBeenCalledWith(
      { skuId: "sku-red-small", quantity: 1 },
      { openDrawer: false },
    );
    await waitFor(() => expect(tracking.track).toHaveBeenCalledTimes(1));
    expect(tracking.track).toHaveBeenCalledWith(
      "AddToCart",
      expect.objectContaining({ content_ids: ["sku-red-small"] }),
    );
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves an out-of-stock combination as a save-for-later", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    render(
      <QuickAddView product={swatchProduct} onAdded={onAdded} onClose={vi.fn()} />,
    );

    await selectOptions(user, ["Red", "Large"]);
    expect(screen.getByTestId("picker-stock-chair")).toHaveTextContent(
      "Out of Stock",
    );

    await user.click(screen.getByTestId("picker-confirm-chair"));

    await waitFor(() => expect(cart.addItem).toHaveBeenCalledTimes(1));
    expect(cart.addItem).toHaveBeenCalledWith(
      { skuId: "sku-red-large", quantity: 1 },
      { openDrawer: false },
    );
    await waitFor(() => expect(tracking.track).toHaveBeenCalledTimes(1));
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it("closes on cancel without firing any events", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickAddView product={swatchProduct} onAdded={onAdded} onClose={onClose} />,
    );

    await user.click(screen.getByRole("link", { name: "Chair" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(tracking.track).not.toHaveBeenCalled();
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("shows an error and fires no events when the add fails", async () => {
    cart.addItem.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    const onAdded = vi.fn();
    render(
      <QuickAddView product={swatchProduct} onAdded={onAdded} onClose={vi.fn()} />,
    );

    await selectOptions(user, ["Red", "Small"]);
    await user.click(screen.getByTestId("picker-confirm-chair"));

    expect(await screen.findByTestId("picker-error-chair")).toHaveTextContent(
      "Sorry, we couldn't add that right now. Please try again.",
    );
    expect(tracking.track).not.toHaveBeenCalled();
    // A failed add never emits a conversion — only the earlier picks fired.
    expect(tracking.trackCustom.mock.calls.map(([name]) => name)).toEqual([
      "option_select",
      "option_select",
    ]);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("emits option_select while picking and variant_confirm once after success", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    render(
      <QuickAddView product={swatchProduct} onAdded={onAdded} onClose={vi.fn()} />,
    );

    await selectOptions(user, ["Red", "Small"]);
    expect(tracking.trackCustom.mock.calls.map(([name]) => name)).toEqual([
      "option_select",
      "option_select",
    ]);
    expect(tracking.trackCustom).toHaveBeenCalledWith(
      "option_select",
      expect.objectContaining({
        product_id: "product-1",
        option_kind: "COLOR",
        option_value_id: "red",
        selection_source: "USER",
      }),
    );

    await user.click(screen.getByTestId("picker-confirm-chair"));
    await waitFor(() => expect(cart.addItem).toHaveBeenCalledTimes(1));
    // Exactly one variant_confirm keyed by the final SKU, then one AddToCart.
    expect(tracking.trackCustom.mock.calls.map(([name]) => name)).toEqual([
      "option_select",
      "option_select",
      "variant_confirm",
    ]);
    expect(tracking.trackCustom).toHaveBeenLastCalledWith(
      "variant_confirm",
      expect.objectContaining({ sku_id: "sku-red-small", source: "QUICK_ADD" }),
    );
    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(tracking.track).toHaveBeenCalledWith(
      "AddToCart",
      expect.objectContaining({ content_ids: ["sku-red-small"] }),
    );
    expect(onAdded).toHaveBeenCalledTimes(1);
  });
});
