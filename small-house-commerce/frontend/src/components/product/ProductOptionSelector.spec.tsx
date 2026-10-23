import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product, ProductMediaSet } from "@/lib/api";
import { clearProductMediaCacheForTests } from "@/lib/product-media";
import { recordProductView } from "@/lib/recently-viewed";
import { PdpPurchaseProvider, usePdpPurchase } from "./PdpPurchaseProvider";
import { ProductOptionSelector } from "./ProductOptionSelector";
import { PdpClient } from "./PdpClient";

/**
 * Minimal Next navigation stand-in. Like Next's shallow History integration,
 * useSearchParams is an external store that updates after native
 * pushState/replaceState and after browser Back/Forward (popstate).
 */
const navigation = vi.hoisted(() => {
  let snapshot = new URLSearchParams();
  const subscribers = new Set<() => void>();
  const notify = () => {
    subscribers.forEach((subscriber) => subscriber());
  };
  return {
    push: vi.fn(),
    replace: vi.fn(),
    get search(): URLSearchParams {
      return snapshot;
    },
    set search(next: URLSearchParams) {
      snapshot = next;
      notify();
    },
    syncFromLocation() {
      snapshot = new URLSearchParams(window.location.search);
      notify();
    },
    subscribe(subscriber: () => void): () => void {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
});
const cart = vi.hoisted(() => ({ addItem: vi.fn(), openPicker: vi.fn() }));
const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
    useSearchParams: () =>
      useSyncExternalStore(navigation.subscribe, () => navigation.search),
  };
});
vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ addItem: cart.addItem, openPicker: cart.openPicker }),
}));
vi.mock("@/components/site/SiteSettingsProvider", () => ({
  useSiteSettings: () => ({
    supportEmail: "help@example.com",
    supportHours: "Daily",
    backInStockEnabled: true,
  }),
}));
vi.mock("@/lib/tracking", () => ({
  track: tracking.track,
  trackCustom: tracking.trackCustom,
}));
vi.mock("@/lib/recently-viewed", () => ({ recordProductView: vi.fn() }));

const sharedMedia: ProductMediaSet = {
  resolvedScope: "SHARED",
  media: [
    {
      id: "shared-1",
      url: "/shared.jpg",
      type: "IMAGE",
      altText: "Shared chair",
      sortOrder: 0,
    },
  ],
  catalogGraphVersion: 7,
};
const blueMedia: ProductMediaSet = {
  resolvedScope: "VARIANT",
  scopeId: "blue-large",
  media: [
    {
      id: "blue-1",
      url: "/blue-1.jpg",
      type: "IMAGE",
      altText: "Blue chair one",
      sortOrder: 0,
    },
    {
      id: "blue-2",
      url: "/blue-2.jpg",
      type: "IMAGE",
      altText: "Blue chair two",
      sortOrder: 1,
    },
  ],
  catalogGraphVersion: 7,
};
const redMedia: ProductMediaSet = {
  resolvedScope: "VARIANT",
  scopeId: "red-small",
  media: [
    {
      id: "red-1",
      url: "/red.jpg",
      type: "IMAGE",
      altText: "Red chair",
      sortOrder: 0,
    },
  ],
  catalogGraphVersion: 7,
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
  materials: null,
  features: null,
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
    },
  ],
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
        availableInventory: 2,
      },
    },
    {
      id: "blue-small-disabled",
      name: "Blue / Small",
      position: 3,
      combinationKey: "color:blue|size:small",
      optionValueIds: ["blue", "small"],
      sku: {
        id: "sku-blue-small",
        skuCode: "BLUE-SMALL",
        status: "DISABLED",
        price: 90,
        compareAtPrice: null,
        availableInventory: 8,
      },
    },
  ],
  defaultDisplayVariantId: "red-small",
  effectiveCoverMedia: sharedMedia.media[0],
  images: sharedMedia.media,
  initialMediaSet: sharedMedia,
  availableMediaScopes: {
    optionValueIds: [],
    variantIds: ["red-small", "blue-large"],
  },
  detailBlocks: [],
};

const delivery = { metro: "2–3 days", provincial: "4–7 days" };

/** A SIZE option whose values carry real thumbnails and SKU measurements. */
function sizeCardProduct(): Product {
  const item = structuredClone(product);
  const size = item.options.find((option) => option.id === "size")!;
  size.presentation = "IMAGE";
  size.values = [
    {
      ...size.values[0],
      label: "Standard · 93 cm",
      thumbnailUrl: "/standard.jpg",
      thumbnailAlt: "Standard cabinet",
    },
    {
      ...size.values[1],
      label: "Tall · 121.5 cm",
      thumbnailUrl: "/tall.jpg",
      thumbnailAlt: "Tall cabinet",
    },
  ];
  for (const variant of item.variants) {
    if (!variant.sku) continue;
    variant.sku.productWidth = 24;
    variant.sku.productDepth = 28;
    variant.sku.productHeight = variant.optionValueIds.includes("large")
      ? 121.5
      : 93;
  }
  return item;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installMediaFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("variantId=blue-large")) return jsonResponse(blueMedia);
    if (url.includes("variantId=red-small")) return jsonResponse(redMedia);
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderPdp({
  item = product,
  variantId = null,
  path = "/products/chair",
  purchaseOnly = false,
  preview = false,
}: {
  item?: Product;
  variantId?: string | null;
  path?: string;
  purchaseOnly?: boolean;
  preview?: boolean;
} = {}) {
  return render(
    <PdpPurchaseProvider product={item} initialVariantId={variantId}>
      <PdpClient
        product={item}
        category={null}
        delivery={delivery}
        productPath={path}
        purchaseOnly={purchaseOnly}
        preview={preview}
      />
    </PdpPurchaseProvider>,
  );
}

function installStickyObserver() {
  let callback: IntersectionObserverCallback | null = null;

  class MockIntersectionObserver {
    constructor(next: IntersectionObserverCallback) {
      callback = next;
    }

    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "0px";
    thresholds = [0];
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

  return {
    leave() {
      if (!callback) throw new Error("Sticky observer was not created");
      act(() => {
        callback?.(
          [{ isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    },
  };
}

let popStateSync: (() => void) | null = null;

beforeEach(() => {
  clearProductMediaCacheForTests();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  cart.addItem.mockReset().mockResolvedValue(undefined);
  cart.openPicker.mockReset();
  tracking.track.mockReset();
  tracking.trackCustom.mockReset();
  vi.restoreAllMocks();

  // Mirror Next: the search-param store updates after native history mutations.
  vi.spyOn(window.history, "pushState").mockImplementation(
    function pushState(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      History.prototype.pushState.apply(this, args);
      navigation.syncFromLocation();
    },
  );
  vi.spyOn(window.history, "replaceState").mockImplementation(
    function replaceState(
      this: History,
      ...args: Parameters<History["replaceState"]>
    ) {
      History.prototype.replaceState.apply(this, args);
      navigation.syncFromLocation();
    },
  );
  popStateSync = () => navigation.syncFromLocation();
  window.addEventListener("popstate", popStateSync);

  navigation.search = new URLSearchParams();
  window.history.replaceState({}, "", "/products/chair");
});

afterEach(() => {
  if (popStateSync) window.removeEventListener("popstate", popStateSync);
  popStateSync = null;
  vi.unstubAllGlobals();
});

function expectDocumentOrder(nodes: readonly HTMLElement[]): void {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    expect(
      nodes[index]!.compareDocumentPosition(nodes[index + 1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
}

describe("isolated landing purchase presentation", () => {
  it("keeps an unavailable campaign target in the URL and requires an explicit alternative before adding", async () => {
    const single = { ...product, variants: [product.variants[2]], defaultDisplayVariantId: product.variants[2].id, availableMediaScopes: { optionValueIds: [], variantIds: [] } };
    window.history.replaceState({}, "", "/lp/campaign?cl=paid-link&variant=deleted-variant");
    const user = userEvent.setup();
    renderPdp({ item: single, variantId: "deleted-variant", path: "/lp/campaign", purchaseOnly: true });
    expect(new URLSearchParams(window.location.search).get("variant")).toBe("deleted-variant");
    await user.click(screen.getByTestId("add-to-cart"));
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Confirm your options" })).toBeInTheDocument();
  });

  it("lets the shopper select and confirm the remaining campaign alternative instead of getting stuck in an empty dialog", async () => {
    const single = { ...product, variants: [product.variants[2]], defaultDisplayVariantId: product.variants[2].id, availableMediaScopes: { optionValueIds: [], variantIds: [] } };
    window.history.replaceState({}, "", "/lp/campaign?variant=deleted-variant");
    const user = userEvent.setup();
    renderPdp({ item: single, variantId: "deleted-variant", path: "/lp/campaign", purchaseOnly: true });
    await user.click(screen.getByTestId("add-to-cart"));
    const dialog = within(screen.getByRole("dialog", { name: "Confirm your options" }));
    expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Blue" }));
    await user.click(dialog.getByRole("button", { name: "Large" }));
    expect(dialog.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(cart.addItem).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(cart.addItem).toHaveBeenCalledWith({ skuId: single.variants[0].sku!.id, quantity: 1 }));
    expect(cart.addItem).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Confirm your options" })).not.toBeInTheDocument();
  });

  it("keeps an unavailable target unconfirmed when browser history returns to its campaign URL", async () => {
    const single = { ...product, variants: [product.variants[2]], defaultDisplayVariantId: product.variants[2].id, availableMediaScopes: { optionValueIds: [], variantIds: [] } };
    window.history.replaceState({}, "", "/lp/campaign");
    const user = userEvent.setup();
    renderPdp({ item: single, path: "/lp/campaign", purchaseOnly: true });
    act(() => {
      History.prototype.pushState.call(window.history, {}, "", "/lp/campaign?variant=deleted-variant");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(new URLSearchParams(window.location.search).get("variant")).toBe("deleted-variant");
    await user.click(screen.getByTestId("add-to-cart"));
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Confirm your options" })).toBeInTheDocument();
  });

  it("reuses live purchase controls without repeating the marketing hero or gallery", () => {
    renderPdp({ purchaseOnly: true });
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Chair" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open image gallery" })).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-purchase")).toHaveTextContent("₱100");
    expect(screen.getByTestId("add-to-cart")).toBeEnabled();
  });

  it("makes private preview non-transactional and suppresses product tracking", () => {
    vi.mocked(recordProductView).mockClear();
    renderPdp({ purchaseOnly: true, preview: true });
    expect(screen.getByTestId("add-to-cart")).toBeDisabled();
    expect(screen.getByTestId("order-now")).toBeDisabled();
    expect(recordProductView).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it("lets preview select a real option without emitting marketing events", async () => {
    const user = userEvent.setup();
    renderPdp({ purchaseOnly: true, preview: true });
    await user.click(within(screen.getByRole("group", { name: "Color" })).getByRole("button", { name: "Blue" }));
    expect(within(screen.getByRole("group", { name: "Color" })).getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("does not mount a live restock trigger in private preview", () => {
    const outOfStock: Product = { ...product, variants: product.variants.map(variant => variant.id === "red-large" ? { ...variant, sku: variant.sku ? { ...variant.sku, availableInventory: 0 } : null } : variant) };
    renderPdp({ item: outOfStock, variantId: "red-large", preview: true });
    expect(screen.queryByRole("button", { name: "Notify me when back in stock" })).toBeNull();
  });
});

describe("PDP conversion hero", () => {
  it("keeps the complete product name with its review summary and all price facts in one group", () => {
    const name = "A long narrow cabinet with adjustable shelves and clear doors for small homes";
    renderPdp({ item: { ...product, name, ratingAverage: 4.8, reviewCount: 12, availableMediaScopes: { optionValueIds: [], variantIds: [] } }, variantId: "red-small" });
    const hero = screen.getByTestId("pdp-purchase");
    const title = within(hero).getByRole("heading", { level: 1, name });
    expect(title).toHaveTextContent(name);
    expect(title).not.toHaveClass("truncate");
    expect(title.parentElement).toContainElement(within(hero).getByRole("link", { name: /12 reviews/ }));
    const priceGroup = within(hero).getByTestId("price").parentElement!;
    expect(priceGroup).toContainElement(within(hero).getByText("Save ₱30.00"));
    expect(priceGroup).toContainElement(within(hero).getByText("23% OFF"));
    expect(within(hero).getByTestId("pdp-delivery")).toHaveAttribute("id", "pdp-delivery");
  });

  it.each([
    { materials: "Solid oak", weight: null, expected: "Solid oak" },
    { materials: null, weight: 2.4, expected: "2.4 kg · Net weight" },
  ])("opens the full guide without a dimensions summary for $expected", async ({ materials, weight, expected }) => {
    const item = structuredClone(product);
    item.materials = materials;
    item.variants.forEach((row) => Object.assign(row.sku!, {
      productWidth: null, productDepth: null, productHeight: null,
      productWeight: weight, packageWeight: null,
    }));
    const user = userEvent.setup();
    renderPdp({ item, variantId: "red-small" });
    expect(screen.queryByTestId("pdp-dimensions-line")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Size guide" }));
    const dialog = screen.getByRole("dialog", { name: "Product details" });
    expect(within(dialog).getByText(expected, { exact: true })).toBeVisible();
    expect(within(dialog).queryByText("Dimensions", { exact: true })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close product details" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("does not offer an empty guide when no public specification fact exists", () => {
    const item = { ...product, options: [], variants: [{ ...product.variants[0], name: "Default", optionValueIds: [] }] };
    renderPdp({ item, variantId: "red-small" });
    expect(screen.queryByRole("button", { name: "Size guide" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdp-dimensions-line")).not.toBeInTheDocument();
  });

  it("uses the Bundle dimension summary and matching component size guide without multiplying quantities", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    Object.assign(item, { width: 999, depth: 999, height: 999 });
    Object.assign(item.variants.find(row => row.id === "red-small")!.sku!, { specificationSource: "BUNDLE_COMPONENTS", productWidth: 999, bundleComponents: [{
      productName: "Chair", variantName: "Oak", quantity: 4, width: 45, depth: 50, height: 80,
      foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Wood",
    }] });
    renderPdp({ item, variantId: "red-small" });
    const summary = screen.getByTestId("pdp-dimensions-line");
    expect(summary).toHaveTextContent("Component dimensions:");
    expect(summary).toHaveTextContent("Chair × 4");
    expect(summary).toHaveTextContent("45W × 80H × 50D cm");
    expect(summary).not.toHaveTextContent("999");
    await user.click(screen.getByRole("button", { name: "Size guide" }));
    const guide = within(screen.getByRole("dialog", { name: "Product details" }));
    const sizeTable = guide.getAllByRole("table")[0];
    const bundleRow = [...sizeTable.querySelectorAll("tbody tr")].find((row) =>
      row.textContent?.includes("Chair / Oak × 4"),
    )!;
    expect(bundleRow).toHaveTextContent("45W × 80H × 50D cm");
    expect(bundleRow).not.toHaveTextContent("393.3");
    expect(guide.queryByText("180 cm")).not.toBeInTheDocument();
  });

  it.each([{ components: [] }, { components: [{ productName: "Chair", variantName: "Oak", quantity: 4, width: null, depth: null, height: null,
    foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: null, materials: "Wood" }] }])("keeps the full guide accessible without borrowing a Bundle parent's measurements %j", async ({ components }) => {
    const item = structuredClone(product);
    Object.assign(item, { width: 999, depth: 999, height: 999 });
    Object.assign(item.variants.find(row => row.id === "red-small")!.sku!, { specificationSource: "BUNDLE_COMPONENTS", bundleComponents: components });
    const user = userEvent.setup();
    renderPdp({ item, variantId: "red-small" });
    expect(screen.queryByTestId("pdp-dimensions-line")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Size guide" }));
    const guide = within(screen.getByRole("dialog", { name: "Product details" }));
    const selected = guide.getAllByRole("table")[0].querySelector('tr[data-selection="selected"]');
    expect(selected).toHaveTextContent("Not provided");
    expect(selected).not.toHaveTextContent("393.3");
    if (components.length) {
      await user.click(guide.getByText("Details"));
      expect([...screen.getByRole("dialog").querySelectorAll('[data-field="materials"]')].some(cell => cell.textContent?.includes("Wood"))).toBe(true);
    }
  });
  it("switches the hero dimensions with the displayed SKU and preserves zero overrides", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    Object.assign(item, { width: 100, depth: 50, height: 70 });
    Object.assign(item.variants.find(row => row.id === "red-small")!.sku!, { productWidth: 120, productDepth: 60, productHeight: 75 });
    Object.assign(item.variants.find(row => row.id === "red-large")!.sku!, { productWidth: 0, productDepth: null, productHeight: 95 });
    renderPdp({ item, variantId: "red-small" });
    const hero = screen.getByTestId("pdp-purchase");
    expect(within(hero).getByTestId("pdp-dimensions-line").textContent).toBe("Dimensions: 120W × 75H × 60D cm");
    await user.click(within(within(hero).getByRole("group", { name: "Size" })).getByRole("button", { name: "Large" }));
    expect(within(hero).getByTestId("pdp-dimensions-line").textContent).toBe("Dimensions: 0W × 95H × 50D cm");
  });

  it("shows the selected SKU dimensions in the size guide without changing folded values", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    Object.assign(item, { width: 100, depth: 50, height: 70, foldedWidth: 90, foldedDepth: 40, foldedHeight: 10 });
    Object.assign(item.variants.find(row => row.id === "red-small")!.sku!, { productWidth: 120, productDepth: 60, productHeight: 75 });
    renderPdp({ item, variantId: "red-small" });
    await user.click(screen.getByRole("button", { name: "Size guide" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("table")[0]).toHaveTextContent("120W × 75H × 60D cm");
    const folded = dialog.querySelector('[data-block="folded"]')!;
    expect(
      [...folded.querySelectorAll("dt, dd")].map((node) => node.textContent?.trim()),
    ).toEqual(["Width", "90 cm", "Folded height", "10 cm", "Folded depth", "40 cm"]);
  });

  it("does not show the default SKU size when only a different size option is selected", async () => {
    const user = userEvent.setup();
    const item = structuredClone(product);
    Object.assign(item.variants.find(row => row.id === "red-small")!.sku!, { productWidth: 94, productDepth: 43, productHeight: 93 });
    Object.assign(item.variants.find(row => row.id === "red-large")!.sku!, { productWidth: 141, productDepth: 60, productHeight: 120 });
    renderPdp({ item });
    expect(screen.getByTestId("pdp-dimensions-line")).toHaveTextContent("Select a configuration");
    const hero = screen.getByTestId("pdp-purchase");
    await user.click(within(within(hero).getByRole("group", { name: "Size" })).getByRole("button", { name: "Large" }));
    expect(screen.getByTestId("pdp-dimensions-line")).toHaveTextContent("Select a configuration");
    expect(screen.getByTestId("pdp-dimensions-line")).not.toHaveTextContent("37W");
    expect(screen.getByRole("button", { name: "Size guide" })).toBeEnabled();
  });

  it("shows a SKU-only zero dimension summary even without parent dimensions", () => {
    const item = structuredClone(product);
    Object.assign(item.variants.find(row => row.id === "red-small")!.sku!, { productWidth: 0, productDepth: null, productHeight: null });
    renderPdp({ item, variantId: "red-small" });
    expect(screen.getByTestId("pdp-dimensions-line").textContent).toBe("Dimensions: 0W cm · H, D not provided");
  });

  it("orders real product facts, purchase actions, then truthful service assurances", () => {
    const item: Product = {
      ...product,
      tagline: "A compact chair for flexible homes.",
      ratingAverage: 4.8,
      reviewCount: 12,
      solutions: ["FOLDABLE", "MOBILE"],
      width: 120,
      height: 74,
      depth: 60,
      foldedWidth: 120,
      foldedHeight: 8,
      foldedDepth: 60,
      availableMediaScopes: {
        optionValueIds: [],
        variantIds: [],
      },
    };

    renderPdp({ item, variantId: "red-small" });

    const hero = screen.getByTestId("pdp-purchase");
    const title = within(hero).getByRole("heading", { name: "Chair" });
    const tagline = within(hero).getByText(
      "A compact chair for flexible homes.",
    );
    const sellingPoints = within(hero).getByRole("list", {
      name: "Selling points",
    });
    const reviews = within(hero).getByRole("link", { name: /12 reviews/i });
    const price = within(hero).getByText("₱100.00");
    const options = within(hero).getByRole("group", { name: "Color" });
    const dimensions = within(hero).getByTestId("pdp-dimensions-summary");
    const assurances = within(hero).getByTestId("pdp-delivery");
    const buyRow = within(hero).getByTestId("pdp-buy-row");
    const orderNow = within(hero).getByTestId("order-now");
    const addToCart = within(hero).getByTestId("add-to-cart");

    expectDocumentOrder([
      title,
      tagline,
      reviews,
      sellingPoints,
      price,
      options,
      dimensions,
      buyRow,
      assurances,
    ]);

    // Selling points are the real solution tags, each with its own line icon.
    const pills = within(sellingPoints).getAllByRole("listitem");
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent("Foldable");
    expect(pills[1]).toHaveTextContent("Easy to Move");
    pills.forEach((pill) => expect(pill.querySelector("svg")).not.toBeNull());
    expect(sellingPoints.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);

    // One compact dimension line with the size guide right beside it; no
    // folded line and no framed card in the hero.
    expect(within(hero).getByTestId("pdp-dimensions-line")).toHaveTextContent(
      "Dimensions: 120W × 74H × 60D cm",
    );
    expect(within(hero).queryByText(/Folded:/)).not.toBeInTheDocument();
    expect(
      within(hero).queryByRole("link", { name: "View full dimensions →" }),
    ).not.toBeInTheDocument();
    expectDocumentOrder([
      within(dimensions).getByTestId("pdp-dimensions-line"),
      within(dimensions).getByRole("button", { name: "Size guide" }),
    ]);

    // Service assurances stand on their own: no delivery estimate beside
    // them and no card drawn around them.
    expect(assurances).toHaveAccessibleName("Service assurances");
    expect(within(assurances).getByText("COD & Free Shipping")).toBeVisible();
    expect(within(assurances).getByText("Arrives as fast as 7 days")).toBeVisible();
    expect(
      within(assurances).getByText("7-Day Free Return & Exchange"),
    ).toBeVisible();
    expect(within(hero).queryByText(/Estimated delivery/i)).toBeNull();
    expect(within(hero).queryByText(/Metro Manila/)).toBeNull();
    expect(assurances.className).not.toMatch(/\brounded-lg\b/);

    // Quantity and both purchase actions share one row.
    expect(buyRow).toContainElement(within(buyRow).getByTestId("qty"));
    expect(buyRow).toContainElement(orderNow);
    expect(buyRow).toContainElement(addToCart);

    expect(orderNow).toHaveClass("bg-cta");
    expect(addToCart).not.toHaveClass("bg-cta");
  });

  it("hides the selling-point row when the product carries no solution tags", () => {
    renderPdp({ item: { ...product, solutions: [] } });

    expect(
      within(screen.getByTestId("pdp-purchase")).queryByRole("list", {
        name: "Selling points",
      }),
    ).not.toBeInTheDocument();
  });

  it("hides the tagline on phones while keeping it from sm up", () => {
    const item: Product = {
      ...product,
      tagline: "A compact chair for flexible homes.",
      availableMediaScopes: { optionValueIds: [], variantIds: [] },
    };
    renderPdp({ item, variantId: "red-small" });

    const tagline = screen.getByText("A compact chair for flexible homes.");
    expect(tagline.classList.contains("hidden")).toBe(true);
    expect(tagline.classList.contains("sm:block")).toBe(true);
  });

  it("keeps the selling points and the assurances to one slidable row on phones", () => {
    const item: Product = {
      ...product,
      solutions: ["FOLDABLE", "MOBILE"],
      availableMediaScopes: { optionValueIds: [], variantIds: [] },
    };
    renderPdp({ item, variantId: "red-small" });

    const hero = screen.getByTestId("pdp-purchase");

    // Tags stay complete in one native horizontal row without extra controls.
    const sellingPoints = within(hero).getByRole("list", {
      name: "Selling points",
    });
    expect(sellingPoints.className).toMatch(/\bflex-nowrap\b/);
    expect(sellingPoints.className).toMatch(/\boverflow-x-auto\b/);
    expect(sellingPoints.className).not.toMatch(/\bsm:flex-wrap\b/);
    expect(sellingPoints).toHaveAttribute("tabindex", "0");
    expect(within(sellingPoints).queryByRole("button")).toBeNull();
    within(sellingPoints)
      .getAllByRole("listitem")
      .forEach((pill) => expect(pill).toHaveClass("shrink-0", "whitespace-nowrap", "text-sm"));

    // The assurances are one row with no card: a phone that cannot fit them
    // scrolls the row sideways instead of stacking the lines.
    const assurances = within(hero).getByTestId("pdp-delivery");
    expect(assurances).toHaveAccessibleName("Service assurances");
    expect(assurances.className).toMatch(/\bflex-nowrap\b/);
    expect(assurances.className).toMatch(/\boverflow-x-auto\b/);
    expect(assurances.className).not.toMatch(/\brounded-lg\b/);
    const items = within(assurances).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    items.forEach((item) =>
      expect(item).toHaveClass("shrink-0", "whitespace-nowrap"),
    );
    // The delivery estimate is gone from the purchase island.
    expect(within(hero).queryByText(/Estimated delivery/i)).toBeNull();
  });
});

describe("shared-state sticky buy", () => {
  it("tracks the current selection and quantity and hands the add to the drawer picker once", async () => {
    installMediaFetch();
    const observer = installStickyObserver();
    const user = userEvent.setup();
    renderPdp({ variantId: "blue-large" });

    observer.leave();
    const sticky = screen.getByTestId("sticky-buy");
    expect(within(sticky).getAllByText("Blue / Large")).toHaveLength(2);
    // The phone summary and the sm+ price block both carry the live price.
    expect(within(sticky).getByTestId("sticky-summary-price")).toHaveTextContent("₱120.00");
    expect(within(sticky).getAllByText("₱120.00")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Small" }));

    expect(within(sticky).getAllByText("Red / Small")).toHaveLength(2);
    expect(within(sticky).getByTestId("sticky-summary-price")).toHaveTextContent("₱100.00");
    expect(within(sticky).getAllByText("₱100.00")).toHaveLength(2);

    await user.click(
      within(sticky).getByRole("button", {
        name: "Increase sticky quantity",
      }),
    );
    expect(screen.getByTestId("qty")).toHaveTextContent("2");
    expect(screen.getByTestId("sticky-qty")).toHaveTextContent("2");

    await user.click(screen.getByTestId("sticky-add-to-cart"));

    // The drawer owns the confirmation: the picker opens pre-set to the
    // chosen combination AND quantity, and nothing is added until its own
    // Confirm.
    expect(cart.openPicker).toHaveBeenCalledTimes(1);
    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: "red-small",
      initialQuantity: 2,
      intent: "ADD_TO_CART",
    });
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(
      tracking.track.mock.calls.filter(([name]) => name === "AddToCart"),
    ).toHaveLength(0);
    expect(
      tracking.trackCustom.mock.calls.filter(
        ([name]) => name === "variant_confirm",
      ),
    ).toHaveLength(0);
  });

  it("opens the same drawer picker for a sticky Order Now, carrying the order-now intent", async () => {
    const observer = installStickyObserver();
    const user = userEvent.setup();
    renderPdp();

    observer.leave();
    await user.click(screen.getByTestId("sticky-order-now"));

    // Both purchase actions share one picker; the intent is what makes the
    // confirmation go to checkout instead of the cart.
    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: null,
      initialQuantity: 1,
      intent: "ORDER_NOW",
    });
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("ProductOptionSelector", () => {
  it("renders accessible IMAGE/SWATCH/TEXT choices and marks impossible choices disabled", async () => {
    const user = userEvent.setup();
    render(
      <PdpPurchaseProvider product={product}>
        <ProductOptionSelector lineId="primary" />
      </PdpPurchaseProvider>,
    );

    expect(screen.getByRole("group", { name: "Color" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(screen.getByRole("button", { name: "Small" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Large" })).toBeEnabled();
  });

  it("renders IMAGE values with both a thumbnail and visible label", () => {
    const imageProduct: Product = {
      ...product,
      options: product.options.map((option) =>
        option.id === "color"
          ? { ...option, presentation: "IMAGE" as const }
          : option,
      ),
    };
    render(
      <PdpPurchaseProvider product={imageProduct}>
        <ProductOptionSelector lineId="primary" />
      </PdpPurchaseProvider>,
    );

    const red = screen.getByRole("button", { name: "Red" });
    expect(within(red).getByRole("img", { name: "Red fabric" })).toHaveAttribute(
      "src",
      "/red-thumb.jpg",
    );
    expect(within(red).getByText("Red")).toBeVisible();
  });

  it("shares the canonical primary-line selection across desktop and mobile renderers", async () => {
    const user = userEvent.setup();
    render(
      <PdpPurchaseProvider product={product}>
        <ProductOptionSelector lineId="primary" instanceId="desktop" />
        <ProductOptionSelector lineId="primary" instanceId="mobile" />
      </PdpPurchaseProvider>,
    );

    const blueButtons = screen.getAllByRole("button", { name: "Blue" });
    await user.click(blueButtons[0]);
    expect(blueButtons).toHaveLength(2);
    for (const button of blueButtons) {
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("supports keyboard focus and activation with native buttons", async () => {
    const user = userEvent.setup();
    render(
      <PdpPurchaseProvider product={product}>
        <ProductOptionSelector lineId="primary" />
      </PdpPurchaseProvider>,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "Red" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders SIZE image values as compact cards with the real SKU size and a visible check", async () => {
    const item = sizeCardProduct();
    render(
      <PdpPurchaseProvider product={item}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );

    const group = screen.getByRole("group", { name: "Size" });
    expect(group.className).toMatch(/\bgrid-cols-2\b/);

    const standard = within(group).getByRole("button", { name: "Standard" });
    const tall = within(group).getByRole("button", { name: "Tall" });
    expect(within(standard).getByRole("img", { name: "Standard cabinet" })).toHaveAttribute(
      "src",
      "/standard.jpg",
    );
    expect(within(standard).getByText("Standard")).toBeVisible();
    expect(within(standard).getByText("93 cm")).toBeVisible();
    expect(within(standard).queryByText("Standard · 93 cm")).not.toBeInTheDocument();
    expect(within(tall).getByText("121.5 cm")).toBeVisible();

    expect(standard).toHaveAttribute("aria-pressed", "false");
    expect(within(standard).queryByTestId("option-selected-check")).not.toBeInTheDocument();

    await userEvent.setup().click(tall);
    expect(tall).toHaveAttribute("aria-pressed", "true");
    expect(within(tall).getByTestId("option-selected-check")).toBeVisible();
  });

  it("keeps the card selection on the same provider state as the purchase island", async () => {
    const item = sizeCardProduct();
    function Probe() {
      const { primaryDerived } = usePdpPurchase();
      return <output data-testid="resolved">{primaryDerived.resolvedVariant?.id ?? "none"}</output>;
    }
    render(
      <PdpPurchaseProvider product={item}>
        <ProductOptionSelector lineId="primary" sizeCards />
        <Probe />
      </PdpPurchaseProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Tall" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("red-large");
    expect(screen.getByRole("button", { name: "Tall" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reads each card's size from the variant matching the other current selections", async () => {
    const item = sizeCardProduct();
    Object.assign(
      item.variants.find((variant) => variant.id === "blue-large")!.sku!,
      { productHeight: 130 },
    );
    render(
      <PdpPurchaseProvider product={item}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Blue" }));
    const group = screen.getByRole("group", { name: "Size" });
    expect(within(group).getByText("24W × 130H × 28D cm")).toBeVisible();
    expect(within(group).getByRole("button", { name: "Tall" })).toHaveAccessibleDescription("24W × 130H × 28D cm");
    expect(within(group).queryByText("121.5 cm")).not.toBeInTheDocument();
  });

  it("uses a single full-width card for one value and falls back to inline buttons without thumbnails", () => {
    const singleValue = sizeCardProduct();
    singleValue.options = singleValue.options.map((option) =>
      option.id === "size" ? { ...option, values: option.values.slice(0, 1) } : option,
    );
    const { unmount } = render(
      <PdpPurchaseProvider product={singleValue}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );
    expect(screen.getByRole("group", { name: "Size" }).className).toMatch(
      /\bgrid-cols-1\b/,
    );
    unmount();

    const noThumbs = sizeCardProduct();
    noThumbs.options = noThumbs.options.map((option) =>
      option.id === "size"
        ? {
            ...option,
            values: option.values.map((value) => ({
              ...value,
              thumbnailUrl: null,
              thumbnailAlt: null,
            })),
          }
        : option,
    );
    render(
      <PdpPurchaseProvider product={noThumbs}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );
    const group = screen.getByRole("group", { name: "Size" });
    expect(group.className).toMatch(/\bflex-wrap\b/);
    expect(group.className).not.toMatch(/\bgrid\b/);
  });

  it("shows every differing axis and keeps labels without an embedded measurement", () => {
    const item = sizeCardProduct();
    const byId = new Map(item.variants.map((variant) => [variant.id, variant]));
    Object.assign(byId.get("red-small")!.sku!, {
      productWidth: 94,
      productHeight: 93,
      productDepth: 43,
    });
    Object.assign(byId.get("red-large")!.sku!, {
      productWidth: 141,
      productHeight: 120,
      productDepth: 60,
    });
    // Both colours carry the same measurements for each size.
    Object.assign(byId.get("blue-large")!.sku!, {
      productWidth: 141,
      productHeight: 120,
      productDepth: 60,
    });
    const size = item.options.find((option) => option.id === "size")!;
    size.values = [
      { ...size.values[0], label: "Standard" },
      { ...size.values[1], label: "Tall" },
    ];
    render(
      <PdpPurchaseProvider product={item}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );

    const group = screen.getByRole("group", { name: "Size" });
    expect(within(group).getByText("94W × 93H × 43D cm")).toBeVisible();
    expect(within(group).getByText("141W × 120H × 60D cm")).toBeVisible();
    expect(within(group).getByText("Standard")).toBeVisible();
    expect(within(group).getByText("Tall")).toBeVisible();
  });

  it("does not guess a card measurement when its remaining SKU configurations disagree", async () => {
    const item = sizeCardProduct();
    item.variants.find((variant) => variant.id === "blue-large")!.sku!.productHeight = 130;
    render(
      <PdpPurchaseProvider product={item}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );
    const tall = screen.getByRole("button", { name: "Tall · 121.5 cm" });
    expect(within(tall).queryByText("121.5 cm")).not.toBeInTheDocument();
    expect(within(tall).getByText("Tall · 121.5 cm")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Red" }));
    expect(within(tall).getByText("121.5 cm")).toBeVisible();
  });

  it("does not quote a disabled SKU's measurement or borrow dimensions for a bundle", async () => {
    const item = sizeCardProduct();
    item.width = 999;
    item.variants.find((variant) => variant.id === "blue-small-disabled")!.sku!.productHeight = 999;
    item.variants.find((variant) => variant.id === "blue-large")!.sku!.specificationSource = "BUNDLE_COMPONENTS";
    render(
      <PdpPurchaseProvider product={item}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Blue" }));
    const standard = screen.getByRole("button", { name: "Standard · 93 cm" });
    const tall = screen.getByRole("button", { name: "Tall · 121.5 cm" });
    expect(standard).toBeDisabled();
    expect(within(standard).queryByText(/in$/)).not.toBeInTheDocument();
    expect(within(tall).queryByText(/in$/)).not.toBeInTheDocument();
    expect(within(tall).getByText("Tall · 121.5 cm")).toBeVisible();
  });

  it("adapts size cards to the container and prioritizes existing thumbnails on TEXT sizes", () => {
    const item = sizeCardProduct();
    item.options.find((option) => option.id === "size")!.presentation = "TEXT";
    render(
      <PdpPurchaseProvider product={item}>
        <ProductOptionSelector lineId="primary" sizeCards />
      </PdpPurchaseProvider>,
    );
    const group = screen.getByRole("group", { name: "Size" });
    expect(group.parentElement).toHaveClass("@container");
    expect(group).toHaveClass("grid-cols-1", "@min-[21rem]:grid-cols-2");
    expect(within(group).getByRole("img", { name: "Standard cabinet" })).toBeVisible();
  });

  it("leaves the shared drawer selector's existing presentation unchanged", () => {
    render(
      <PdpPurchaseProvider product={sizeCardProduct()}>
        <ProductOptionSelector lineId="primary" />
      </PdpPurchaseProvider>,
    );
    const group = screen.getByRole("group", { name: "Size" });
    expect(group).toHaveClass("flex-wrap");
    expect(within(group).queryByTestId("option-selected-check")).not.toBeInTheDocument();
    expect(within(group).getByText("Standard · 93 cm")).toBeVisible();
  });

  it("uses the card layout on the PDP purchase island without changing other selectors", () => {
    renderPdp({ item: sizeCardProduct(), variantId: "red-small" });
    const hero = screen.getByTestId("pdp-purchase");
    const group = within(hero).getByRole("group", { name: "Size" });
    expect(group.className).toMatch(/\bgrid-cols-2\b/);
    expect(
      within(group).getByRole("img", { name: "Standard cabinet" }),
    ).toHaveAttribute("src", "/standard.jpg");
  });
});

describe("PDP option confirmation and deep links", () => {
  it("keeps the CTA labels stable and the default variant display-only", () => {
    renderPdp();

    expect(screen.getAllByText("₱100.00")[0]).toBeVisible();
    // The labels never change with resolution: the pickers are what resolve.
    expect(screen.getByTestId("add-to-cart")).toHaveTextContent("ADD TO CART");
    expect(screen.getByTestId("order-now")).toHaveTextContent("ORDER NOW");
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("opens the drawer picker pre-set to the deep-linked variant instead of adding directly", async () => {
    installMediaFetch();
    navigation.search = new URLSearchParams("campaign=spring&variant=blue-large");
    window.history.replaceState(
      {},
      "",
      "/products/chair?campaign=spring&variant=blue-large",
    );
    const user = userEvent.setup();
    renderPdp({ variantId: "blue-large" });

    expect(screen.getAllByText("₱120.00")[0]).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Blue chair one" })).toBeVisible(),
    );
    const trigger = screen.getByTestId("add-to-cart");
    trigger.focus();
    await user.click(trigger);

    expect(cart.openPicker).toHaveBeenCalledTimes(1);
    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: "blue-large",
      initialQuantity: 1,
      intent: "ADD_TO_CART",
    });
    expect(
      screen.queryByRole("dialog", { name: "Confirm your options" }),
    ).not.toBeInTheDocument();
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalledWith(
      "AddToCart",
      expect.anything(),
    );
  });

  it("hands an Order Now to the drawer picker without navigating the PDP", async () => {
    installMediaFetch();
    navigation.search = new URLSearchParams("variant=blue-large");
    const user = userEvent.setup();
    renderPdp({ variantId: "blue-large" });

    await user.click(screen.getByTestId("order-now"));

    // Order Now rides the same picker as Add to Cart; only the confirmation
    // inside the drawer reaches checkout, so the PDP itself neither navigates
    // nor converts here (QuickAddView owns the checkout handoff and its
    // variant_confirm).
    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: "blue-large",
      initialQuantity: 1,
      intent: "ORDER_NOW",
    });
    expect(navigation.push).not.toHaveBeenCalled();
    expect(tracking.track.mock.calls.map(([name]) => name)).toEqual([
      "ViewContent",
    ]);
  });

  it("still routes an already-confirmed Order Now through the picker", async () => {
    installMediaFetch();
    const user = userEvent.setup();
    renderPdp();

    // Both groups explicitly touched: the combination is complete and
    // confirmed, and Order Now still asks in the same picker before checkout.
    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Small" }));
    await user.click(screen.getByTestId("order-now"));

    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: "red-small",
      initialQuantity: 1,
      intent: "ORDER_NOW",
    });
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("hands every add-to-cart to the drawer pre-set to the current combination", async () => {
    installMediaFetch();
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Small" }));
    await user.click(screen.getByTestId("add-to-cart"));
    expect(cart.openPicker).toHaveBeenLastCalledWith(product, {
      initialVariantId: "red-small",
      initialQuantity: 1,
      intent: "ADD_TO_CART",
    });
    expect(cart.addItem).not.toHaveBeenCalled();

    // A later mutation flows into the next picker opening — the drawer is
    // never pre-set to a stale combination.
    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await user.click(screen.getByTestId("add-to-cart"));
    expect(cart.openPicker).toHaveBeenLastCalledWith(product, {
      initialVariantId: "blue-large",
      initialQuantity: 1,
      intent: "ADD_TO_CART",
    });
    expect(cart.openPicker).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("dialog", { name: "Confirm your options" }),
    ).not.toBeInTheDocument();
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("offers one merged action for an out-of-stock combination and hides Order Now", async () => {
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    expect(screen.getByTestId("stock-state")).toHaveTextContent("Out of Stock");

    // An unavailable item has one entry: the restock alert that also keeps
    // the item saved. There is no second add-to-cart button next to it.
    expect(screen.queryByTestId("order-now")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-to-cart")).not.toBeInTheDocument();
    const notify = screen.getByTestId("notify-me");
    expect(notify).toHaveTextContent("Notify me when available");

    // It asks for the contact first; the item is only saved once the alert
    // is registered.
    await user.click(notify);
    expect(cart.openPicker).not.toHaveBeenCalled();
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalledWith(
      expect.stringContaining("/checkout"),
      expect.anything(),
    );
  });

  it("hands a confirmed Order Now to the picker exactly once", async () => {
    navigation.search = new URLSearchParams("variant=blue-large");
    const user = userEvent.setup();
    renderPdp({ variantId: "blue-large" });

    await user.click(screen.getByTestId("order-now"));

    // The handoff is a single picker opening; checkout happens only from the
    // picker's own confirmation (covered by QuickAddView).
    expect(cart.openPicker).toHaveBeenCalledTimes(1);
    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: "blue-large",
      initialQuantity: 1,
      intent: "ORDER_NOW",
    });
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("lets a single selectable SKU resolve and add directly", async () => {
    const single = {
      ...product,
      id: "single-product",
      variants: [product.variants[0]],
      options: product.options.map((option) => ({
        ...option,
        values: option.values.filter((value) =>
          product.variants[0].optionValueIds.includes(value.id),
        ),
      })),
      availableMediaScopes: { optionValueIds: [], variantIds: [] },
    };
    const user = userEvent.setup();
    renderPdp({ item: single });

    expect(screen.queryByText("Choose Color")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("add-to-cart"));
    await waitFor(() =>
      expect(cart.addItem).toHaveBeenCalledWith({
        skuId: "sku-red-small",
        quantity: 1,
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Confirm your options" })).not.toBeInTheDocument();
  });

  it("removes only an invalid variant param and returns to ordinary unselected state", async () => {
    navigation.search = new URLSearchParams("campaign=spring&variant=missing");
    window.history.replaceState(
      {},
      "",
      "/products/chair?campaign=spring&variant=missing",
    );
    renderPdp();

    await waitFor(() => expect(window.location.search).toBe("?campaign=spring"));
    expect(screen.getByTestId("add-to-cart")).toHaveTextContent("ADD TO CART");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["blue-small-disabled", product],
    [
      "blue-large",
      {
        ...product,
        variants: product.variants.map((variant) =>
          variant.id === "blue-large" && variant.sku
            ? { ...variant, sku: { ...variant.sku, price: null } }
            : variant,
        ),
      } satisfies Product,
    ],
  ])(
    "removes disabled or unpriced deep link %s without selecting a purchase SKU",
    async (variantId, item) => {
      navigation.search = new URLSearchParams(
        `campaign=spring&variant=${variantId}`,
      );
      window.history.replaceState(
        {},
        "",
        `/products/chair?campaign=spring&variant=${variantId}`,
      );
      renderPdp({ item, variantId });

      await waitFor(() => expect(window.location.search).toBe("?campaign=spring"));
      expect(screen.getByTestId("add-to-cart")).toHaveTextContent(
        "ADD TO CART",
      );
      expect(cart.addItem).not.toHaveBeenCalled();
    },
  );

  it("updates only variant via shallow history while preserving unrelated params", async () => {
    navigation.search = new URLSearchParams("campaign=spring");
    window.history.replaceState({}, "", "/products/chair?campaign=spring");
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));

    await waitFor(() =>
      expect(pushState).toHaveBeenCalledWith(
        null,
        "",
        "/products/chair?campaign=spring&variant=blue-large",
      ),
    );
    expect(navigation.push).not.toHaveBeenCalled();
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("uses the same provider state after rerender and remounts for a new deep-link identity", async () => {
    function Probe() {
      const { primaryDerived } = usePdpPurchase();
      return <output>{primaryDerived.resolvedVariant?.id ?? "none"}</output>;
    }
    function Harness() {
      const [variantId, setVariantId] = useState<string | null>(null);
      return (
        <>
          <button onClick={() => setVariantId("blue-large")}>Remount deep link</button>
          <PdpPurchaseProvider product={product} initialVariantId={variantId}>
            <ProductOptionSelector lineId="primary" />
            <Probe />
          </PdpPurchaseProvider>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Red" }));
    expect(screen.getByText("none")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Small" }));
    expect(screen.getByText("red-small")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remount deep link" }));
    expect(screen.getByText("blue-large")).toBeVisible();
  });
});

describe("scoped gallery integration", () => {
  it("replaces an LP override after selection, resets index, and closes the lightbox", async () => {
    installMediaFetch();
    const landingProduct = {
      ...product,
      images: [
        { ...sharedMedia.media[0], id: "lp-1", url: "/lp-1.jpg", altText: "LP one" },
        { ...sharedMedia.media[0], id: "lp-2", url: "/lp-2.jpg", altText: "LP two", sortOrder: 1 },
      ],
    };
    const user = userEvent.setup();
    renderPdp({ item: landingProduct, path: "/lp/chair-sale" });

    await user.click(screen.getByRole("button", { name: "View media 2" }));
    await user.click(screen.getByRole("button", { name: "Open media 2" }));
    expect(screen.getByRole("dialog", { name: "Product image gallery" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Blue chair one" })).toBeVisible(),
    );
    expect(screen.queryByRole("dialog", { name: "Product image gallery" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View media 1" })).toHaveClass("border-cta");
  });

  it("keeps fallback within the selected scope when scoped media fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Blue fabric" })).toHaveAttribute(
        "src",
        "/blue-thumb.jpg",
      ),
    );
    expect(screen.queryByRole("img", { name: "Shared chair" })).not.toBeInTheDocument();
  });

  it("ignores a late response from a previous scope and deduplicates the current scope", async () => {
    let resolveRed!: (response: Response) => void;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("red-small")) {
        return new Promise<Response>((resolve) => {
          resolveRed = resolve;
        });
      }
      if (url.includes("blue-large")) return Promise.resolve(jsonResponse(blueMedia));
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Small" }));
    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Blue chair one" })).toBeVisible(),
    );
    resolveRed(jsonResponse(redMedia));
    await Promise.resolve();
    expect(screen.getByRole("img", { name: "Blue chair one" })).toBeVisible();
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("blue-large"))).toHaveLength(1);
  });

  it("retries the same scope after failure without leaking console or hydration errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(blueMedia));
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Retry images" }));
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Blue chair one" })).toBeVisible(),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((value) => /hydration|did not match|uncaught/i.test(String(value))),
      ),
    ).toBe(false);
  });
});

describe("browser history navigation", () => {
  it("does not re-push after browser Back and resets to the clean-URL default", async () => {
    installMediaFetch();
    navigation.search = new URLSearchParams("campaign=spring");
    window.history.replaceState({}, "", "/products/chair?campaign=spring");
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await waitFor(() =>
      expect(pushState).toHaveBeenCalledWith(
        null,
        "",
        "/products/chair?campaign=spring&variant=blue-large",
      ),
    );
    pushState.mockClear();

    window.history.back();
    await waitFor(() =>
      expect(window.location.search).toBe("?campaign=spring"),
    );

    expect(pushState).not.toHaveBeenCalled();
    expect(screen.getByTestId("add-to-cart")).toHaveTextContent(
      "ADD TO CART",
    );
    expect(screen.getAllByText("₱100.00")[0]).toBeVisible();

    // A genuine later selection still pushes; suppression must not stick.
    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await waitFor(() =>
      expect(pushState).toHaveBeenCalledWith(
        null,
        "",
        "/products/chair?campaign=spring&variant=blue-large",
      ),
    );
  });

  it("reconciles browser Forward to the popped variant without re-pushing and keeps it unconfirmed", async () => {
    installMediaFetch();
    navigation.search = new URLSearchParams("campaign=spring");
    window.history.replaceState({}, "", "/products/chair?campaign=spring");
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await waitFor(() =>
      expect(pushState).toHaveBeenCalledWith(
        null,
        "",
        "/products/chair?campaign=spring&variant=blue-large",
      ),
    );
    pushState.mockClear();

    window.history.back();
    await waitFor(() =>
      expect(window.location.search).toBe("?campaign=spring"),
    );
    expect(pushState).not.toHaveBeenCalled();

    window.history.forward();
    await waitFor(() =>
      expect(window.location.search).toBe(
        "?campaign=spring&variant=blue-large",
      ),
    );

    expect(pushState).not.toHaveBeenCalled();
    expect(screen.getAllByText("₱120.00")[0]).toBeVisible();
    expect(screen.getByTestId("add-to-cart")).toHaveTextContent(
      "ADD TO CART",
    );

    // A URL-restored selection stays unconfirmed; add-to-cart opens the
    // drawer pre-set to it instead of adding silently.
    await user.click(screen.getByTestId("add-to-cart"));
    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: "blue-large",
      initialQuantity: 1,
      intent: "ADD_TO_CART",
    });
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("keeps a confirmed USER selection confirmed after a fragment-only popstate", async () => {
    installMediaFetch();
    navigation.search = new URLSearchParams("campaign=spring");
    window.history.replaceState({}, "", "/products/chair?campaign=spring");
    const pushState = vi.spyOn(window.history, "pushState");
    function Probe() {
      const { primaryLine } = usePdpPurchase();
      return (
        <output data-testid="source">
          {primaryLine.selectionSource}:
          {primaryLine.confirmedCombinationKey ?? "none"}
        </output>
      );
    }
    const user = userEvent.setup();
    render(
      <PdpPurchaseProvider product={product}>
        <PdpClient
          product={product}
          category={null}
          delivery={delivery}
        />
        <Probe />
      </PdpPurchaseProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Small" }));
    await waitFor(() => expect(pushState).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("source")).toHaveTextContent(
      "USER:color:red|size:small",
    );

    // Same-page anchor (e.g. #reviews): search unchanged, hash changes, and
    // the browser fires popstate for the fragment navigation.
    await act(async () => {
      window.history.pushState(
        null,
        "",
        "/products/chair?campaign=spring&variant=red-small#reviews",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.hash).toBe("#reviews");

    expect(screen.getByTestId("source")).toHaveTextContent(
      "USER:color:red|size:small",
    );
    await user.click(screen.getByTestId("add-to-cart"));
    expect(cart.openPicker).toHaveBeenCalledWith(product, {
      initialVariantId: "red-small",
      initialQuantity: 1,
      intent: "ADD_TO_CART",
    });
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Confirm your options" }),
    ).not.toBeInTheDocument();
  });

  it("still reconciles the URL after a no-op fragment pop from DEEP_LINK state", async () => {
    installMediaFetch();
    navigation.search = new URLSearchParams("variant=blue-large");
    window.history.replaceState(
      {},
      "",
      "/products/chair?variant=blue-large",
    );
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    renderPdp({ variantId: "blue-large" });

    // Fragment-only pop while DEEP_LINK state already matches the variant:
    // a stuck suppression must not swallow the next selection's URL effect.
    await act(async () => {
      window.history.pushState(
        null,
        "",
        "/products/chair?variant=blue-large#details",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.hash).toBe("#details");

    // Blue/Large -> Red keeps the compatible Large (red-large exists).
    await user.click(screen.getByRole("button", { name: "Red" }));
    await waitFor(() =>
      expect(pushState).toHaveBeenCalledWith(
        null,
        "",
        "/products/chair?variant=red-large",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Small" }));
    await waitFor(() =>
      expect(pushState).toHaveBeenCalledWith(
        null,
        "",
        "/products/chair?variant=red-small",
      ),
    );
  });

  it("fires ViewContent once for the displayed SKU and option_select on changes", async () => {
    const user = userEvent.setup();
    renderPdp();

    // The displayed SKU at mount is the default display variant.
    await waitFor(() =>
      expect(tracking.track).toHaveBeenCalledWith(
        "ViewContent",
        expect.objectContaining({
          content_ids: ["sku-red-small"],
          content_type: "product",
          value: 100,
          currency: "PHP",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(tracking.trackCustom).toHaveBeenCalledWith(
      "option_select",
      expect.objectContaining({
        product_id: "product-1",
        option_kind: "COLOR",
        option_value_id: "blue",
        selection_source: "USER",
      }),
    );

    // Re-selecting the selected value is a no-op, not another option_select,
    // and an option change never re-fires ViewContent.
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(tracking.track.mock.calls.map(([name]) => name)).toEqual([
      "ViewContent",
    ]);
    expect(tracking.trackCustom).toHaveBeenCalledTimes(1);
  });

  it("emits variant_confirm and AddToCart exactly once after a direct single-variant add", async () => {
    const single = {
      ...product,
      id: "single-product",
      variants: [product.variants[0]],
      options: product.options.map((option) => ({
        ...option,
        values: option.values.filter((value) =>
          product.variants[0].optionValueIds.includes(value.id),
        ),
      })),
      availableMediaScopes: { optionValueIds: [], variantIds: [] },
    };
    const user = userEvent.setup();
    renderPdp({ item: single });

    await user.click(screen.getByTestId("add-to-cart"));

    await waitFor(() => expect(cart.addItem).toHaveBeenCalledTimes(1));
    expect(cart.addItem).toHaveBeenCalledWith({
      skuId: "sku-red-small",
      quantity: 1,
    });
    expect(tracking.track.mock.calls.map(([name]) => name)).toEqual([
      "ViewContent",
      "AddToCart",
    ]);
    expect(tracking.track).toHaveBeenCalledWith(
      "AddToCart",
      expect.objectContaining({
        content_ids: ["sku-red-small"],
        contents: [{ id: "sku-red-small", quantity: 1 }],
        value: 100,
        currency: "PHP",
      }),
    );
    expect(tracking.trackCustom.mock.calls.map(([name]) => name)).toEqual([
      "variant_confirm",
    ]);
    expect(tracking.trackCustom).toHaveBeenCalledWith(
      "variant_confirm",
      expect.objectContaining({
        product_id: "single-product",
        variant_id: "red-small",
        sku_id: "sku-red-small",
        source: "PDP",
      }),
    );
  });
});

describe("PDP restock alert", () => {
  it("drops the separate out-of-stock card and its contact link", () => {
    const outOfStock: Product = {
      ...product,
      variants: product.variants.map((variant) =>
        variant.id === "red-small" && variant.sku
          ? { ...variant, sku: { ...variant.sku, availableInventory: 0 } }
          : variant,
      ),
    };
    renderPdp({ item: outOfStock, variantId: "red-small" });

    // The purchase area keeps one action and no wall of small print.
    expect(screen.queryByText("Currently out of stock")).not.toBeInTheDocument();
    expect(screen.queryByText("Contact us to order")).not.toBeInTheDocument();
    expect(screen.queryByTestId("oos-contact")).not.toBeInTheDocument();
    expect(screen.getByTestId("notify-me")).toBeInTheDocument();
  });

  it("keeps the item in the cart when the shopper registers a restock alert", async () => {
    const outOfStock: Product = {
      ...product,
      variants: product.variants.map((variant) =>
        variant.id === "red-small" && variant.sku
          ? { ...variant, sku: { ...variant.sku, availableInventory: 0 } }
          : variant,
      ),
    };
    const submit = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const user = userEvent.setup();
    renderPdp({ item: outOfStock, variantId: "red-small" });

    await user.click(screen.getByTestId("notify-me"));
    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "shopper@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(await screen.findByTestId("storefront-toast")).toHaveTextContent(
      "We’ll notify you when it’s back in stock.",
    );
    expect(submit).toHaveBeenCalledWith(
      "/api/v1/storefront/back-in-stock",
      expect.objectContaining({
        body: JSON.stringify({
          email: "shopper@example.com",
          skuId: "sku-red-small",
        }),
      }),
    );
    // The alert and the saved cart line are one action.
    expect(cart.addItem).toHaveBeenCalledTimes(1);
    expect(cart.addItem).toHaveBeenCalledWith(
      { skuId: "sku-red-small", quantity: 1 },
      { openDrawer: false, silent: true },
    );
  });
});
