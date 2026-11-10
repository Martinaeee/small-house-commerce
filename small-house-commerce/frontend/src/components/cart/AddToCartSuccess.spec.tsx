import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product } from "@/lib/api";
import { installDesktopViewport } from "@/test/desktop-viewport";
import { CartProvider, useCart } from "./CartContext";
import { CartDrawer } from "./CartDrawer";

/**
 * The added-drawer contract: every successful cart-opening add shows the
 * JD-style "Added to cart" view in the same drawer — title rises in the
 * hero, cross-category picks fill the body, and the footer offers
 * "Continue shopping" (stay here) or "Go to cart" (leave for checkout).
 * The variant picker resolves to the same view after its Confirm, so both
 * purchase paths agree on what a successful add looks like.
 */

const apiMock = vi.hoisted(() => ({
  getCart: vi.fn(),
  getCollectionProducts: vi.fn(),
  getProducts: vi.fn(),
  addToCart: vi.fn(),
}));
const cartStorageMock = vi.hoisted(() => ({
  get: vi.fn(() => null),
  set: vi.fn(),
}));
const productCacheMock = vi.hoisted(() => ({ fetchProduct: vi.fn() }));
const navigationMock = vi.hoisted(() => {
  let push: (href: string) => void;
  return { setPush: (fn: typeof push) => { push = fn; }, push: () => push };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => navigationMock.push()(href),
  }),
}));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  cartStorage: cartStorageMock,
}));
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

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "Folding Stool",
    slug: "folding-stool",
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
    images: [],
    variants: [
      {
        id: "v-1",
        name: "Stool",
        position: 0,
        combinationKey: "",
        optionValueIds: [],
        sku: {
          id: "sku-1",
          skuCode: "STOOL-1",
          status: "ACTIVE",
          price: 299,
          compareAtPrice: 399,
          availableInventory: 8,
        },
      },
    ],
    ...overrides,
  };
}

const cartSummary = {
  cartId: "cart-added-test",
  items: [],
  subtotal: 0,
  discount: 0,
  shipping: 0,
  total: 0,
  expiresAt: "2030-01-01T00:00:00Z",
  created: true,
};

const routerPush = vi.fn();
navigationMock.setPush((href) => routerPush(href));

/** Test utility: fires one cart-opening add the way PDP actions do. */
function AddTrigger() {
  const { addItem, isOpen } = useCart();
  return (
    <>
      <button type="button" onClick={() => void addItem({ skuId: "sku-1", quantity: 1 })}>
        add to cart
      </button>
      <output data-testid="drawer-open">{String(isOpen)}</output>
    </>
  );
}

/** Test utility: opens the shared variant picker through the real context. */
function PickerTrigger({ product }: { product: Product }) {
  const { openPicker } = useCart();
  return (
    <button type="button" onClick={() => openPicker(product)}>
      open picker
    </button>
  );
}

function renderDrawer(node?: React.ReactNode) {
  return render(
    <CartProvider>
      {node}
      <CartDrawer />
    </CartProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getCart.mockResolvedValue(null);
  apiMock.addToCart.mockResolvedValue(cartSummary);
});

describe("CartDrawer mobile added sheet", () => {
  it("presents the confirmation as a bottom sheet with a drag handle on phones", async () => {
    const restore = installDesktopViewport(false);
    apiMock.getCollectionProducts.mockResolvedValue({ items: [buildProduct()] });
    apiMock.getProducts.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderDrawer(<AddTrigger />);

    await user.click(screen.getByRole("button", { name: "add to cart" }));
    await screen.findByRole("heading", { name: "Added to cart" });

    const sheet = screen.getByTestId("cart-added-sheet");
    expect(within(sheet).getByRole("heading", { name: "Added to cart" })).toBeVisible();
    const grabber = within(sheet).getByTestId("cart-added-grabber");
    expect(grabber).toHaveAttribute("aria-expanded", "false");

    // Dragging the handle upward lets the shopper pull the sheet to fill the
    // page (to read the recommendations); dragging down puts it back.
    fireEvent.pointerDown(grabber, { pointerId: 1, clientX: 30, clientY: 100 });
    fireEvent.pointerMove(grabber, { pointerId: 1, clientX: 30, clientY: 20 });
    fireEvent.pointerUp(grabber, { pointerId: 1, clientX: 30, clientY: 20 });
    expect(grabber).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Added to cart" })).not.toBeInTheDocument());
    restore(false);
  });

  it("keeps the drag at rest and closes from the corner button", async () => {
    const restore = installDesktopViewport(false);
    apiMock.getCollectionProducts.mockResolvedValue({ items: [buildProduct()] });
    apiMock.getProducts.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderDrawer(<AddTrigger />);

    await user.click(screen.getByRole("button", { name: "add to cart" }));
    await screen.findByRole("heading", { name: "Added to cart" });
    const grabber = screen.getByTestId("cart-added-grabber");

    // Small drags under the snap threshold never expand the sheet.
    fireEvent.pointerDown(grabber, { pointerId: 1, clientX: 30, clientY: 100 });
    fireEvent.pointerMove(grabber, { pointerId: 1, clientX: 30, clientY: 80 });
    fireEvent.pointerUp(grabber, { pointerId: 1, clientX: 30, clientY: 80 });
    expect(grabber).toHaveAttribute("aria-expanded", "false");

    await user.click(within(screen.getByTestId("cart-added-sheet")).getByRole("button", { name: "Close cart" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Added to cart" })).not.toBeInTheDocument());
    restore(false);
  });

  it("keeps the right-hand desktop panel without a grabber", async () => {
    const restore = installDesktopViewport(true);
    apiMock.getCollectionProducts.mockResolvedValue({ items: [buildProduct()] });
    apiMock.getProducts.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderDrawer(<AddTrigger />);

    await user.click(screen.getByRole("button", { name: "add to cart" }));
    await screen.findByRole("heading", { name: "Added to cart" });

    expect(screen.queryByTestId("cart-added-sheet")).toBeNull();
    expect(screen.queryByTestId("cart-added-grabber")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue shopping" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Added to cart" })).not.toBeInTheDocument());
    restore(false);
  });
});

describe("CartDrawer added view", () => {
  it("shows the added confirmation with picks after a cart-opening add", async () => {
    apiMock.getCollectionProducts.mockResolvedValue({ items: [buildProduct()] });
    apiMock.getProducts.mockResolvedValue({ items: [] });
    productCacheMock.fetchProduct.mockResolvedValue(null);
    const user = userEvent.setup();
    renderDrawer(<AddTrigger />);

    await user.click(screen.getByRole("button", { name: "add to cart" }));

    expect(await screen.findByRole("heading", { name: "Added to cart" })).toBeVisible();
    // The picker/cart header is replaced by the confirmation in this view.
    expect(screen.queryByRole("heading", { name: /Your Cart/ })).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Added to cart" });
    expect(within(dialog).getByRole("heading", { name: "More picks for you" })).toBeVisible();
    expect(within(dialog).getAllByText("Folding Stool").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("₱299.00")).toBeVisible();
  });

  it("closes from Continue shopping and leaves the shopper in place", async () => {
    apiMock.getCollectionProducts.mockResolvedValue({ items: [buildProduct()] });
    apiMock.getProducts.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderDrawer(<AddTrigger />);

    await user.click(screen.getByRole("button", { name: "add to cart" }));
    await screen.findByRole("heading", { name: "Added to cart" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue shopping" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("hands Go to cart to the cart page and closes the drawer", async () => {
    apiMock.getCollectionProducts.mockResolvedValue({ items: [buildProduct()] });
    apiMock.getProducts.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderDrawer(<AddTrigger />);

    await user.click(screen.getByRole("button", { name: "add to cart" }));
    await screen.findByRole("heading", { name: "Added to cart" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Go to cart" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(routerPush).toHaveBeenCalledWith("/cart");
  });

  it("lands on the same confirmation after a picker confirm", async () => {
    const product = buildProduct({
      id: "product-picker",
      options: [
        {
          id: "color",
          kind: "COLOR",
          name: "Color",
          position: 0,
          presentation: "SWATCH",
          isMediaDriver: false,
          values: [
            { id: "red", label: "Red", position: 0, swatchHex: "#ff0000", thumbnailUrl: null, thumbnailAlt: null },
            { id: "blue", label: "Blue", position: 1, swatchHex: "#0000ff", thumbnailUrl: null, thumbnailAlt: null },
          ],
        },
      ],
      variants: [
        {
          id: "v-red",
          name: "Red",
          position: 0,
          combinationKey: "color:red",
          optionValueIds: ["red"],
          sku: {
            id: "sku-red",
            skuCode: "RED",
            status: "ACTIVE",
            price: 150,
            compareAtPrice: null,
            availableInventory: 3,
          },
        },
        {
          id: "v-blue",
          name: "Blue",
          position: 1,
          combinationKey: "color:blue",
          optionValueIds: ["blue"],
          sku: {
            id: "sku-blue",
            skuCode: "BLUE",
            status: "ACTIVE",
            price: 160,
            compareAtPrice: null,
            availableInventory: 3,
          },
        },
      ],
    });
    apiMock.getCollectionProducts.mockResolvedValue({ items: [] });
    apiMock.getProducts.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderDrawer(<PickerTrigger product={product} />);

    await user.click(screen.getByRole("button", { name: "open picker" }));
    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByTestId("picker-confirm-folding-stool"));

    expect(await screen.findByRole("heading", { name: "Added to cart" })).toBeVisible();
    // The picker did not fall through to the cart list on success.
    expect(within(screen.getByRole("dialog")).queryByRole("heading", { name: /Your Cart/ })).toBeNull();
  });
});
