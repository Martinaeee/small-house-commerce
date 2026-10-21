import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { CartProvider, useCart } from "@/components/cart/CartContext";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site-settings";
import { PdpPurchaseProvider, usePdpPurchase } from "./PdpPurchaseProvider";
import * as purchase from "./PdpPurchaseProvider";
import { cardTestProduct } from "@/test/product-card-fixtures";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => tracking);

const cartSummary = { cartId: "card-test-cart", items: [], subtotal: 120, discount: 0,
  shipping: 0, total: 120, expiresAt: "2030-01-01T00:00:00Z", created: true };

function CartProbe() {
  const { isOpen } = useCart();
  return <output data-testid="card-cart-open">{String(isOpen)}</output>;
}

function renderCard(node: ReactNode) {
  return render(node, { wrapper: ({ children }) => <CartProvider>{children}<CartProbe /></CartProvider> });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(api, "addToCart").mockResolvedValue(cartSummary);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "@/lib/api";
import { ProductCard } from "./ProductCard";

/**
 * Storefront polish (2026-09-27): the shared ProductCard (homepage grid,
 * collections, related products) shows the rating row from existing product
 * data — stars + average + review count — only when the product actually has
 * reviews. DESIGN_SYSTEM §12 puts the rating between the name and the price.
 */

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
    images: [],
    variants: [],
    ...overrides,
  };
}

function styleOption(variantNames: string[]): StorefrontProductOption {
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
      compareAtPrice: skuOverrides.compareAtPrice ?? null,
      availableInventory: skuOverrides.availableInventory ?? 4,
    },
  };
}

const singleSkuProduct = buildProduct({
  options: [styleOption(["Oak"])],
  variants: [singleVariant({})],
  defaultDisplayVariantId: "v-single",
});

describe("ProductCard inline purchase", () => {
  it("contains the absolute live status inside the card action boundary", () => {
    renderCard(<ProductCard product={singleSkuProduct} />);

    expect(
      within(screen.getByRole("article")).getByRole("status").parentElement,
    ).toHaveClass("relative");
  });

  it("does not inherit an inferred PDP default for images, choices or a uniform compare-at price", () => {
    const product = cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: {
      displayVariantId: null, unselected: { cover: null, scene: null }, variants: [],
    } });
    product.variants[1]!.sku!.price = 100;
    const { container } = renderCard(<ProductCard product={product} />);
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("price")).toHaveTextContent("₱100.00");
    expect(screen.queryByText("₱150.00")).not.toBeInTheDocument();
    expect(screen.queryByText("₱130.00")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
  it("keeps twelve long variants reachable and restores focus after cancelling more options", async () => {
    const user = userEvent.setup();
    const product = cardTestProduct();
    const option = product.options[0]!;
    option.values = Array.from({ length: 12 }, (_, i) => ({
      id: `long-${i}`, label: `Performance Multi Twill, Cream with finish ${i}`,
      position: i, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
    }));
    const source = product.variants[0]!;
    product.variants = option.values.map((value, i) => ({ ...source, id: `long-variant-${i}`, name: value.label,
      combinationKey: `color:${value.id}`, optionValueIds: [value.id], sku: { ...source.sku!, id: `long-sku-${i}`, skuCode: `LONG-${i}` },
    }));
    renderCard(<ProductCard product={product} />);
    const more = screen.queryByRole("button", { name: "More Color options" });
    expect(more).toBeInTheDocument();
    await user.click(more!);
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "Search options" }), "finish 11");
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    await user.click(more!);
    await user.click(screen.getByRole("button", { name: "Performance Multi Twill, Cream with finish 11" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Performance Multi Twill, Cream with finish 11" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Performance Multi Twill, Cream with finish 0" })).not.toBeInTheDocument();
    expect(tracking.trackCustom.mock.calls.filter(([name]) => name === "option_select")).toHaveLength(1);
    expect(api.addToCart).not.toHaveBeenCalled();
  });
  it("uses a valid default SKU for its exact price, cover and deep links", () => {
    const product = cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: {
      displayVariantId: "blue-variant",
      unselected: { cover, scene: null }, variants: [{ variantId: "blue-variant",
        cover: { id: "blue-photo", url: "/blue.webp", type: "IMAGE", altText: "Blue table", sortOrder: 0 }, scene: null }],
    } });
    renderCard(<ProductCard product={product} />);
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("price")).toHaveTextContent("₱120.00");
    expect(screen.getByText("₱150.00")).toBeInTheDocument();
    expect(screen.getByAltText("Blue table")).toHaveAttribute("src", "/blue.webp");
    for (const link of screen.getAllByRole("link", { name: "Oak Side Table" })) {
      expect(link).toHaveAttribute("href", "/products/oak-side-table?variant=blue-variant");
    }
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it("selects a SKU inline and opens the actual cart context on a successful add", async () => {
    const user = userEvent.setup();
    const href = location.href;
    renderCard(<ProductCard product={cardTestProduct()} />);
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(screen.getByTestId("price")).toHaveTextContent("₱120.00");
    expect(screen.getByText("₱150.00")).toBeInTheDocument();
    expect(tracking.track).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeInTheDocument();
    expect(api.addToCart).toHaveBeenCalledTimes(1);
    expect(api.addToCart).toHaveBeenCalledWith(expect.objectContaining({ skuId: "blue-sku", quantity: 1 }));
    expect(screen.getByTestId("card-cart-open")).toHaveTextContent("true");
    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(tracking.track).toHaveBeenCalledWith("AddToCart", expect.objectContaining({ content_ids: ["blue-sku"], value: 120 }));
    expect(tracking.trackCustom).toHaveBeenCalledWith("variant_confirm", expect.objectContaining({ sku_id: "blue-sku", source: "QUICK_ADD" }));
    expect(tracking.trackCustom.mock.calls.filter(([name]) => name === "variant_confirm")).toHaveLength(1);
    expect(location.href).toBe(href);
  });

  it("focuses the missing group rather than adding a guessed SKU", async () => {
    const user = userEvent.setup();
    renderCard(<ProductCard product={cardTestProduct()} />);
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose your options");
    expect(screen.getByRole("button", { name: "Red" })).toHaveFocus();
    expect(api.addToCart).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalled();
  });

  it("focuses More when a hidden size still needs selection and adds only the completed SKU", async () => {
    const product = cardTestProduct();
    product.options.push({ id: "size", name: "Size", kind: "SIZE", position: 1, presentation: "TEXT", isMediaDriver: false,
      values: [{ id: "small", label: "Small", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null }] });
    product.variants = product.variants.map(row => ({ ...row, combinationKey: `${row.combinationKey}|size:small`, optionValueIds: [...row.optionValueIds, "small"] }));
    renderCard(<ProductCard product={product} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(api.addToCart).not.toHaveBeenCalled();
    const more = screen.getByRole("button", { name: "More options" });
    expect(more).toHaveFocus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Product options" });
    await user.click(within(dialog).getByRole("button", { name: "Small" }));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeInTheDocument();
    expect(api.addToCart).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ skuId: "blue-sku", quantity: 1 }));
  });

  it("locks the request synchronously and disables options until the add settles", async () => {
    let resolve!: (value: typeof cartSummary) => void;
    vi.mocked(api.addToCart).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    renderCard(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />);
    const button = screen.getByRole("button", { name: "Add to Cart" });
    act(() => { button.click(); button.click(); });
    expect(api.addToCart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Blue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Red" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Adding/ })).toBeDisabled();
    await act(async () => resolve(cartSummary));
    expect(screen.getByRole("button", { name: "Added" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Blue" })).toBeEnabled();
    expect(tracking.track).toHaveBeenCalledTimes(1);
  });

  it("announces loading and success within the current card", async () => {
    let resolve!: (value: typeof cartSummary) => void;
    vi.mocked(api.addToCart).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const { container } = renderCard(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />);
    const article = container.querySelector("article")!;
    fireEvent.click(within(article).getByRole("button", { name: "Add to Cart" }));
    expect(within(article).getByRole("status")).toHaveTextContent("Adding to cart");
    await act(async () => resolve(cartSummary));
    expect(within(article).getByRole("status")).toHaveTextContent("Added to cart");
  });

  it("keeps selection after a failed add, emits no conversion, and supports retry", async () => {
    vi.mocked(api.addToCart).mockRejectedValueOnce(new Error("Try this add again"));
    const user = userEvent.setup();
    renderCard(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />);
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try this add again");
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalledWith("variant_confirm", expect.anything());
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeInTheDocument();
    expect(api.addToCart).toHaveBeenCalledTimes(2);
    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets an out-of-stock SKU be saved for later instead of inventing availability", async () => {
    const product = cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } });
    product.variants[1]!.sku!.availableInventory = 0;
    const user = userEvent.setup();
    renderCard(<ProductCard product={product} />);
    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save for Later" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeInTheDocument();
    expect(api.addToCart).toHaveBeenCalledWith(expect.objectContaining({ skuId: "blue-sku", quantity: 1 }));
  });

  it("opens an alert for the exact out-of-stock SKU and keeps the item in the cart", async () => {
    const product = cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } });
    product.variants[1]!.sku!.availableInventory = 0;
    const submit = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const user = userEvent.setup();
    renderCard(
      <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, backInStockEnabled: true }}>
        <ProductCard product={product} />
      </SiteSettingsProvider>,
    );
    expect(screen.getByRole("button", { name: "Save for Later" })).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Notify me when back in stock" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "shopper@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(await screen.findByText(/also in your cart/)).toBeVisible();
    expect(submit).toHaveBeenCalledWith(
      "/api/v1/storefront/back-in-stock",
      expect.objectContaining({
        body: JSON.stringify({
          email: "shopper@example.com",
          skuId: "blue-sku",
        }),
      }),
    );
    // One click covers both wishes: the alert is saved and the item is kept
    // in the cart, so the shopper does not have to add it a second time.
    expect(api.addToCart).toHaveBeenCalledTimes(1);
    expect(api.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ skuId: "blue-sku", quantity: 1 }),
    );
    // The card still offers the same action (its label flips to "Added"
    // while the card shows the result).
    expect(screen.getByRole("button", { name: /Save for Later|Added/ })).toBeEnabled();
  });

  it("does not add the item twice when a restock alert is requested again", async () => {
    const product = cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } });
    product.variants[1]!.sku!.availableInventory = 0;
    vi.spyOn(api, "addToCart").mockResolvedValue({
      ...cartSummary,
      items: [
        {
          itemId: "line-blue",
          skuId: "blue-sku",
          skuCode: "BLUE",
          productName: product.name,
          productSlug: product.slug,
          variantName: "Blue",
          quantity: 1,
          unitPrice: 120,
          compareAtPrice: null,
          lineTotal: 120,
          availableInventory: 0,
          unavailable: true,
          optionValues: [],
          thumbnail: null,
        },
      ],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const user = userEvent.setup();
    renderCard(
      <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, backInStockEnabled: true }}>
        <ProductCard product={product} />
      </SiteSettingsProvider>,
    );

    for (let round = 0; round < 2; round++) {
      await user.click(
        screen.getByRole("button", { name: "Notify me when back in stock" }),
      );
      await user.type(
        screen.getByRole("textbox", { name: "Email address" }),
        "shopper@example.com",
      );
      await user.click(screen.getByRole("button", { name: "Notify me" }));
      await screen.findByText(/also in your cart/);
      await user.click(screen.getByRole("button", { name: "Done" }));
    }

    // The second alert does not add a second copy of the same SKU.
    expect(api.addToCart).toHaveBeenCalledTimes(1);
  });

  it("explains which selected combination is out of stock", async () => {
    const product = cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } });
    product.variants[1]!.sku!.availableInventory = 0;
    renderCard(<ProductCard product={product} />);

    const note = screen.getByTestId("card-out-of-stock-note");
    expect(note.textContent).toMatch(/out of stock/i);
    expect(note.textContent).toMatch(/Blue/);
    expect(screen.getByRole("button", { name: "Save for Later" })).toBeInTheDocument();
  });

  it("shows no out-of-stock line when the resolved combination is available", () => {
    renderCard(<ProductCard product={cardTestProduct()} />);
    expect(screen.queryByTestId("card-out-of-stock-note")).toBeNull();
  });

  it("adds a zero-priced single SKU without a variant confirmation event", async () => {
    const product = cardTestProduct();
    product.variants = [product.variants[0]!];
    product.variants[0]!.sku!.price = 0;
    const user = userEvent.setup();
    renderCard(<ProductCard product={product} />);
    expect(screen.getByTestId("price")).toHaveTextContent("₱0.00");
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeInTheDocument();
    expect(api.addToCart).toHaveBeenCalledWith(expect.objectContaining({ skuId: "red-sku", quantity: 1 }));
    expect(tracking.track).toHaveBeenCalledWith("AddToCart", expect.objectContaining({ value: 0 }));
    expect(tracking.trackCustom).not.toHaveBeenCalledWith("variant_confirm", expect.anything());
  });

  it("keeps two cards' choices and locks independent", async () => {
    let resolve!: (value: typeof cartSummary) => void;
    vi.mocked(api.addToCart).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const user = userEvent.setup();
    const { container } = renderCard(<>
      <ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />
      <ProductCard product={cardTestProduct({ id: "second-product" })} />
    </>);
    const articles = container.querySelectorAll("article");
    await user.click(within(articles[0]!).getByRole("button", { name: "Add to Cart" }));
    expect(within(articles[0]!).getByRole("button", { name: "Blue" })).toBeDisabled();
    expect(within(articles[1]!).getByRole("button", { name: "Blue" })).toBeEnabled();
    await user.click(within(articles[1]!).getByRole("button", { name: "Red" }));
    expect(within(articles[1]!).getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => resolve(cartSummary));
    expect(within(articles[0]!).getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the enclosing PDP selection untouched", async () => {
    function OuterSelection() {
      const { primaryDerived } = usePdpPurchase();
      return <output data-testid="outer-pdp-variant">{primaryDerived.resolvedVariant?.id}</output>;
    }
    const product = cardTestProduct();
    const user = userEvent.setup();
    renderCard(<PdpPurchaseProvider product={product} initialVariantId="red-variant">
      <OuterSelection /><ProductCard product={product} />
    </PdpPurchaseProvider>);
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("outer-pdp-variant")).toHaveTextContent("red-variant");
  });

  it("preserves a choice across same-identity rerenders and resets it at a new graph revision", async () => {
    const user = userEvent.setup();
    const product = cardTestProduct();
    const view = renderCard(<ProductCard product={product} />);
    await user.click(screen.getByRole("button", { name: "Blue" }));
    view.rerender(<ProductCard product={{ ...product, name: "Updated name" }} />);
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    view.rerender(<ProductCard product={{ ...product, catalogGraphVersion: 2 }} />);
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "false");
  });

  it("uses the old request snapshot for late success without marking a replacement card Added", async () => {
    let resolve!: (value: typeof cartSummary) => void;
    vi.mocked(api.addToCart).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const user = userEvent.setup();
    const view = renderCard(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />);
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    view.rerender(<ProductCard product={cardTestProduct({ id: "replacement", name: "Replacement Table" })} />);
    await act(async () => resolve(cartSummary));
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Added" })).not.toBeInTheDocument();
    expect(tracking.track).toHaveBeenCalledWith("AddToCart", expect.objectContaining({ content_ids: ["blue-sku"], content_name: "Oak Side Table", value: 120 }));
    expect(tracking.trackCustom).toHaveBeenCalledWith("variant_confirm", expect.objectContaining({ product_id: "product-1", variant_id: "blue-variant" }));
  });

  it("confirms the real selection before locking the provider dispatch", async () => {
    const actualHook = purchase.usePdpPurchase;
    const states: Array<ReturnType<typeof actualHook>> = [];
    vi.spyOn(purchase, "usePdpPurchase").mockImplementation(() => {
      const state = actualHook();
      states.push(state);
      return state;
    });
    let resolve!: (value: typeof cartSummary) => void;
    vi.mocked(api.addToCart).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    renderCard(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />);
    expect(states.at(-1)?.primaryDerived.purchaseConfirmed).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(states.at(-1)?.purchaseLocked).toBe(true);
    expect(states.at(-1)?.primaryDerived.purchaseConfirmed).toBe(true);
    await act(async () => resolve(cartSummary));
  });

  it("does not let an earlier success timer erase a later failure", async () => {
    vi.useFakeTimers();
    vi.mocked(api.addToCart).mockResolvedValueOnce(cartSummary).mockRejectedValueOnce(new Error("Keep this failure visible"));
    renderCard(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Cart" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Added" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Keep this failure visible");
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("alert")).toHaveTextContent("Keep this failure visible");
  });

  it("clears successful feedback after two seconds", async () => {
    vi.useFakeTimers();
    renderCard(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: { displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [] } })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Cart" })));
    expect(screen.getByRole("button", { name: "Added" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByRole("button", { name: "Added" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeInTheDocument();
    expect(api.addToCart).toHaveBeenCalledTimes(1);
  });

  it("keeps all long-label style candidates reachable and submits the chosen last SKU", async () => {
    const base = cardTestProduct();
    const values = Array.from({ length: 100 }, (_, i) => ({ id: `style-${i}`, label: `Long upholstered style label number ${i}`,
      position: i, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null }));
    const product = cardTestProduct({ options: [{ id: "styles", name: "Style", kind: "STYLE", position: 0, presentation: "TEXT", isMediaDriver: false, values }],
      variants: values.map(value => ({ id: `variant-${value.id}`, name: value.label, position: value.position,
        combinationKey: `styles:${value.id}`, optionValueIds: [value.id], sku: { ...base.variants[0]!.sku!, id: `sku-${value.id}` } })) });
    const user = userEvent.setup();
    renderCard(<ProductCard product={product} />);
    expect(within(screen.getByRole("group", { name: "Style" })).getAllByRole("button")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "More Style options" }));
    expect(within(screen.getByRole("dialog")).getAllByRole("button", { name: /^Long upholstered style label/ })).toHaveLength(100);
    await user.type(screen.getByRole("searchbox", { name: "Search options" }), "number 99");
    await user.click(screen.getByRole("button", { name: "Long upholstered style label number 99" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Long upholstered style label number 99" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Add to Cart" }));
    await screen.findByRole("button", { name: "Added" });
    expect(api.addToCart).toHaveBeenCalledWith(expect.objectContaining({ skuId: "sku-style-99", quantity: 1 }));
  });
});

describe("ProductCard rating row", () => {
  it("renders stars, the average and the review count when the product has reviews", () => {
    renderCard(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: 4.6,
          reviewCount: 128,
        })}
      />,
    );

    const row = screen.getByTestId("card-rating");
    expect(row).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Rated 4.6 out of 5" }),
    ).toBeInTheDocument();
    expect(row).toHaveTextContent("4.6");
    expect(row).toHaveTextContent("(128)");
  });

  it("hides the rating row when the average is null even with reviews", () => {
    renderCard(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: null,
          reviewCount: 12,
        })}
      />,
    );

    expect(screen.queryByTestId("card-rating")).toBeNull();
    expect(screen.queryByRole("img", { name: /^Rated / })).toBeNull();
  });

  it("hides the rating row when the review count is zero", () => {
    renderCard(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: 4.6,
          reviewCount: 0,
        })}
      />,
    );

    expect(screen.queryByTestId("card-rating")).toBeNull();
    expect(screen.queryByRole("img", { name: /^Rated / })).toBeNull();
  });

  it("rounds a 4.5 average to four filled stars and one half star", () => {
    renderCard(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: 4.5,
          reviewCount: 8,
        })}
      />,
    );

    const row = screen.getByRole("img", { name: "Rated 4.5 out of 5" });
    expect(
      Array.from(row.querySelectorAll("span")).map((glyph) => glyph.textContent),
    ).toEqual(["★", "★", "★", "★", "★"]);
    expect(row.querySelector('[data-rating-star="half"]')).toHaveTextContent("★");
    expect(row).not.toHaveTextContent("⯨");
  });
});

describe("ProductCard sale price presentation", () => {
  const discountedProduct = buildProduct({
    options: [styleOption(["Oak"])],
    variants: [singleVariant({ price: 100, compareAtPrice: 125 })],
    defaultDisplayVariantId: "v-single",
  });

  it("shows the sale price and struck-through compare-at price without a discount chip", () => {
    renderCard(<ProductCard product={discountedProduct} />);
    expect(screen.queryByText(/% OFF/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-discount")).not.toBeInTheDocument();
    expect(screen.getByText("₱125.00")).toHaveClass("line-through");
    expect(screen.queryByText("Out of Stock")).toBeNull();
  });

  it("keeps stock over the image while the compare-at price stays beside the price", () => {
    renderCard(
      <ProductCard
        product={buildProduct({
          ...discountedProduct,
          variants: [
            singleVariant({
              price: 100,
              compareAtPrice: 125,
              availableInventory: 0,
            }),
          ],
        })}
      />,
    );

    const left = screen.getByTestId("card-left-chips");
    const outOfStock = screen.getByText("Out of Stock");
    expect(left).toContainElement(outOfStock);
    expect(left).not.toHaveTextContent(/% OFF/);
    expect(screen.getByText("₱125.00")).toHaveClass("line-through");
  });

  it("keeps the section badge in the top-right slot without a discount chip", () => {
    renderCard(<ProductCard product={discountedProduct} badge="New" />);

    const badge = screen.getByText("New");
    expect(screen.queryByText(/% OFF/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-discount")).not.toBeInTheDocument();
    expect(badge).toHaveClass("right-3");
  });

  it("renders no discount chip without a strictly higher compare-at price", () => {
    renderCard(<ProductCard product={singleSkuProduct} />);

    expect(screen.queryByTestId("card-discount")).toBeNull();
  });

  it("renders no discount chip when the price presentation is From", () => {
    // Two sellable SKUs at different prices resolve to kind "from"; even the
    // SKU that carries a compare-at must not look discounted on the card.
    const fromPricedProduct = buildProduct({
      options: [
        {
          id: "size-opt",
          kind: "SIZE",
          name: "Size",
          position: 0,
          presentation: "TEXT",
          isMediaDriver: false,
          values: [
            {
              id: "size-s",
              label: "S",
              position: 0,
              swatchHex: null,
              thumbnailUrl: null,
              thumbnailAlt: null,
            },
            {
              id: "size-l",
              label: "L",
              position: 1,
              swatchHex: null,
              thumbnailUrl: null,
              thumbnailAlt: null,
            },
          ],
        },
      ],
      variants: [
        {
          id: "v-s",
          name: "S",
          position: 0,
          combinationKey: "size-opt:size-s",
          optionValueIds: ["size-s"],
          sku: {
            id: "sku-s",
            skuCode: "S",
            status: "ACTIVE",
            price: 100,
            compareAtPrice: 125,
            availableInventory: 4,
          },
        },
        {
          id: "v-l",
          name: "L",
          position: 1,
          combinationKey: "size-opt:size-l",
          optionValueIds: ["size-l"],
          sku: {
            id: "sku-l",
            skuCode: "L",
            status: "ACTIVE",
            price: 120,
            compareAtPrice: null,
            availableInventory: 4,
          },
        },
      ],
    });

    renderCard(<ProductCard product={fromPricedProduct} />);

    expect(screen.getByTestId("price")).toHaveTextContent("From");
    expect(screen.queryByTestId("card-discount")).toBeNull();
  });

  it("renders no discount chip when the card has no sellable price", () => {
    renderCard(
      <ProductCard
        product={buildProduct({
          options: [styleOption(["Oak"])],
          // sku.price null → nothing sellable → cardPricePresentation returns
          // null; the kind guard must not fall through to an "undefined% OFF".
          variants: [
            {
              id: "v-unpriced",
              name: "Oak",
              position: 0,
              combinationKey: "style-opt:style-val-1",
              optionValueIds: ["style-val-1"],
              sku: {
                id: "sku-unpriced",
                skuCode: "OAK-UNPRICED",
                status: "ACTIVE",
                price: null,
                compareAtPrice: null,
                availableInventory: 0,
              },
            },
          ],
        })}
      />,
    );

    expect(screen.queryByTestId("card-discount")).toBeNull();
  });
});

describe("ProductCard compact commerce summary", () => {
  it("shows a fixed-size red sale price and a gray struck-through original on one row", () => {
    const product = buildProduct({
      options: [styleOption(["Oak"])],
      variants: [singleVariant({ price: 100, compareAtPrice: 125 })],
      defaultDisplayVariantId: "v-single",
    });
    renderCard(<ProductCard product={product} />);

    const row = screen.getByTestId("card-price-row");
    const sale = screen.getByTestId("price");
    const original = screen.getByTestId("card-compare-at");
    expect(row).toHaveClass("flex", "flex-wrap", "items-baseline", "gap-x-1.5");
    expect(sale).toHaveClass("text-[16px]", "font-bold", "text-sale", "whitespace-nowrap", "sm:text-[18px]");
    expect(original).toHaveClass("text-xs", "text-ink-muted", "line-through", "whitespace-nowrap");
    expect(screen.queryByText(/% OFF/)).not.toBeInTheDocument();
  });

  it("keeps the product name to one truncated line", () => {
    renderCard(<ProductCard product={cardTestProduct({ name: "An exceptionally long product name that must not take two lines" })} />);
    const name = screen.getByTestId("card-name");
    expect(name).toHaveClass("truncate");
    expect(name).not.toHaveClass("line-clamp-2");
  });

  it("puts the tiny variant choices directly below the price with their real thumbnails", () => {
    const product = cardTestProduct();
    const color = product.options[0]!;
    color.presentation = "SWATCH";
    color.values[0]!.thumbnailUrl = "/red-thumb.jpg";
    color.values[1]!.thumbnailUrl = "/blue-thumb.jpg";
    renderCard(<ProductCard product={product} />);

    const strip = screen.getByTestId("card-variant-strip");
    expect(screen.getByTestId("card-price-row").nextElementSibling).toBe(strip);
    const stripImages = within(strip).getByRole("group", { name: "Color" }).querySelectorAll("img");
    expect(stripImages).toHaveLength(2);
    expect(stripImages[0]).toHaveAttribute("src", "/red-thumb.jpg");
    for (const button of within(strip).getAllByRole("button")) {
      expect(button).toHaveClass("h-6", "w-6");
    }
  });
});
