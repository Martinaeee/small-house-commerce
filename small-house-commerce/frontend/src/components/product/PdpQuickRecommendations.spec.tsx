import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/api";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { installDesktopViewport } from "@/test/desktop-viewport";
import { PdpQuickRecommendations } from "./PdpQuickRecommendations";

const mocks = vi.hoisted(() => ({
  cart: { items: [] as { productSlug: string }[] },
  recommendations: [] as Product[],
  addItem: vi.fn(),
  openPicker: vi.fn(),
  emit: vi.fn(),
}));
vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ cart: mocks.cart, addItem: mocks.addItem, openPicker: mocks.openPicker }),
}));
vi.mock("@/lib/useCartRecommendations", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/useCartRecommendations")>(),
  useCartRecommendations: () => mocks.recommendations,
}));
vi.mock("@/lib/commerce-events", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/commerce-events")>(),
  emitCommerceEvent: mocks.emit,
}));

function singleProduct(slug: string, stock = 4): Product {
  const product = cardTestProduct({ id: slug, slug, name: slug });
  return {
    ...product,
    options: [],
    variants: [{
      ...product.variants[0], id: `${slug}-variant`, combinationKey: "", optionValueIds: [],
      sku: { ...product.variants[0].sku!, id: `${slug}-sku`, availableInventory: stock },
    }],
  };
}
const current = singleProduct("current");

beforeEach(() => {
  vi.clearAllMocks();
  installDesktopViewport(false);
  mocks.cart = { items: [] };
  mocks.recommendations = [];
  mocks.addItem.mockResolvedValue({});
});

describe("PdpQuickRecommendations", () => {
  it("offers up to three distinct in-stock recommendations excluding the current product and cart lines", () => {
    mocks.cart = { items: [{ productSlug: "owned" }] };
    const a = singleProduct("a");
    render(<PdpQuickRecommendations currentProduct={current} fallback={[
      current, singleProduct("owned"), singleProduct("sold-out", 0),
      a, singleProduct("b"), a, singleProduct("c"), singleProduct("d"),
    ]} />);

    const region = screen.getByRole("region", { name: "Quick add recommendations" });
    const cards = within(region).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(cards.map(card => card.querySelector("a")?.getAttribute("href")))
      .toEqual(["/products/a", "/products/b", "/products/c"]);
    expect(within(region).getAllByRole("button")).toHaveLength(3);
  });

  it("adds a single-SKU recommendation without leaving the PDP or opening the cart", async () => {
    const user = userEvent.setup();
    render(<PdpQuickRecommendations currentProduct={current} fallback={[singleProduct("a")]} />);
    await user.click(screen.getByRole("button", { name: "Add a to cart" }));

    expect(mocks.addItem).toHaveBeenCalledWith({ skuId: "a-sku", quantity: 1 }, { openDrawer: false });
    expect(screen.getByRole("status")).toHaveTextContent("Added to cart");
    expect(mocks.openPicker).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({
      name: "AddToCart", productId: "a", data: expect.objectContaining({ content_ids: ["a-sku"], value: 100 }),
    }));
  });

  it("opens the shared picker for multi-variant recommendations instead of guessing a SKU", async () => {
    const user = userEvent.setup();
    const product = cardTestProduct({ id: "multi", slug: "multi", name: "Multi table" });
    render(<PdpQuickRecommendations currentProduct={current} fallback={[product]} />);
    expect(screen.getByRole("listitem").textContent).toContain("From ₱100.00");
    await user.click(screen.getByRole("button", { name: "Add Multi table to cart" }));

    expect(mocks.openPicker).toHaveBeenCalledWith(product, { intent: "ADD_TO_CART" });
    expect(mocks.addItem).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("blocks repeated adds while a request is pending", async () => {
    let finish!: () => void;
    mocks.addItem.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<PdpQuickRecommendations currentProduct={current} fallback={[singleProduct("a"), singleProduct("b")]} />);
    const add = screen.getByRole("button", { name: "Add a to cart" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByRole("button", { name: "Add b to cart" })).toBeDisabled();
    expect(mocks.addItem).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(screen.getByRole("status")).toHaveTextContent("Added to cart");
  });

  it("keeps a failed recommendation add retryable and emits no conversion before success", async () => {
    const user = userEvent.setup();
    mocks.addItem.mockRejectedValueOnce(new Error("offline"));
    render(<PdpQuickRecommendations currentProduct={current} fallback={[singleProduct("a")]} />);
    const add = screen.getByRole("button", { name: "Add a to cart" });
    await user.click(add);
    expect(screen.getByRole("status")).toHaveTextContent("Could not add. Try again.");
    expect(add).toBeEnabled();
    expect(mocks.emit).not.toHaveBeenCalled();
    await user.click(add);
    expect(mocks.addItem).toHaveBeenCalledTimes(2);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });

  it("drops products as they enter the cart", () => {
    const fallback = [singleProduct("a"), singleProduct("b")];
    const { rerender } = render(<PdpQuickRecommendations currentProduct={current} fallback={fallback} />);
    mocks.cart = { items: [{ productSlug: "a" }] };
    rerender(<PdpQuickRecommendations currentProduct={current} fallback={fallback} />);
    expect(screen.queryByRole("button", { name: "Add a to cart" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add b to cart" })).toBeInTheDocument();
  });

  it("does not render an empty strip", () => {
    const { container } = render(<PdpQuickRecommendations currentProduct={current} fallback={[current, singleProduct("sold-out", 0)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves desktop recommendations unchanged", () => {
    installDesktopViewport();
    const { container } = render(<PdpQuickRecommendations currentProduct={current} fallback={[singleProduct("a")]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
