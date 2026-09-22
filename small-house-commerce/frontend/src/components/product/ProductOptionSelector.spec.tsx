import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product, ProductMediaSet } from "@/lib/api";
import { clearProductMediaCacheForTests } from "@/lib/product-media";
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
const cart = vi.hoisted(() => ({ addItem: vi.fn() }));
const tracking = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
    useSearchParams: () =>
      useSyncExternalStore(navigation.subscribe, () => navigation.search),
  };
});
vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ addItem: cart.addItem }),
}));
vi.mock("@/components/site/SiteSettingsProvider", () => ({
  useSiteSettings: () => ({
    supportEmail: "help@example.com",
    supportHours: "Daily",
  }),
}));
vi.mock("@/lib/tracking", () => ({ track: tracking.track }));
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
}: {
  item?: Product;
  variantId?: string | null;
  path?: string;
} = {}) {
  return render(
    <PdpPurchaseProvider product={item} initialVariantId={variantId}>
      <PdpClient
        product={item}
        category={null}
        delivery={delivery}
        productPath={path}
      />
    </PdpPurchaseProvider>,
  );
}

let popStateSync: (() => void) | null = null;

beforeEach(() => {
  clearProductMediaCacheForTests();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  cart.addItem.mockReset().mockResolvedValue(undefined);
  tracking.track.mockReset();
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
});

describe("PDP option confirmation and deep links", () => {
  it("keeps the default variant display-only and labels an ordinary unresolved CTA CHOOSE OPTIONS", () => {
    renderPdp();

    expect(screen.getAllByText("₱100.00")[0]).toBeVisible();
    expect(screen.getByTestId("add-to-cart")).toHaveTextContent("CHOOSE OPTIONS");
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(cart.addItem).not.toHaveBeenCalled();
  });

  it("shows an exact valid deep-linked variant but requires confirmation before add-to-cart", async () => {
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

    const dialog = screen.getByRole("dialog", { name: "Confirm your options" });
    expect(dialog).toBeVisible();
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalledWith(
      "AddToCart",
      expect.anything(),
    );

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(cart.addItem).toHaveBeenCalledWith({
        skuId: "sku-blue-large",
        quantity: 1,
      }),
    );
    expect(cart.addItem).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Confirm your options" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("does not navigate for an unconfirmed Order Now and performs it once after confirmation", async () => {
    installMediaFetch();
    navigation.search = new URLSearchParams("variant=blue-large");
    const user = userEvent.setup();
    renderPdp({ variantId: "blue-large" });

    await user.click(screen.getByTestId("order-now"));
    expect(screen.getByRole("dialog", { name: "Confirm your options" })).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(navigation.push).toHaveBeenCalledWith(
      "/checkout?skuId=sku-blue-large&qty=1&slug=chair",
    );
    expect(navigation.push).toHaveBeenCalledTimes(1);
  });

  it("confirms after every group is explicitly touched and invalidates after a later mutation", async () => {
    installMediaFetch();
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Small" }));
    await user.click(screen.getByTestId("add-to-cart"));
    await waitFor(() => expect(cart.addItem).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Large" }));
    await user.click(screen.getByTestId("add-to-cart"));
    expect(screen.getByRole("dialog", { name: "Confirm your options" })).toBeVisible();
    expect(cart.addItem).toHaveBeenCalledTimes(1);
  });

  it("allows confirmed active OOS add-to-cart save behavior but blocks Order Now", async () => {
    const user = userEvent.setup();
    renderPdp();

    await user.click(screen.getByRole("button", { name: "Red" }));
    await user.click(screen.getByRole("button", { name: "Large" }));
    expect(screen.getByTestId("stock-state")).toHaveTextContent("Out of Stock");
    await user.click(screen.getByTestId("add-to-cart"));
    await waitFor(() =>
      expect(cart.addItem).toHaveBeenCalledWith({
        skuId: "sku-red-large",
        quantity: 1,
      }),
    );
    expect(screen.queryByTestId("order-now")).not.toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalledWith(
      expect.stringContaining("/checkout"),
      expect.anything(),
    );
  });

  it("executes a confirmed pending intent only once even on repeated confirm clicks", async () => {
    navigation.search = new URLSearchParams("variant=blue-large");
    const user = userEvent.setup();
    let resolveAdd!: () => void;
    cart.addItem.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAdd = resolve;
      }),
    );
    renderPdp({ variantId: "blue-large" });

    await user.click(screen.getByTestId("add-to-cart"));
    const confirm = screen.getByRole("button", { name: "Confirm" });
    await user.dblClick(confirm);
    expect(cart.addItem).toHaveBeenCalledTimes(1);
    resolveAdd();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm your options" })).not.toBeInTheDocument(),
    );
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
    expect(screen.getByTestId("add-to-cart")).toHaveTextContent("CHOOSE OPTIONS");
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
        "CHOOSE OPTIONS",
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
    await user.click(screen.getByRole("button", { name: "Open image gallery" }));
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
      "CHOOSE OPTIONS",
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

    // A URL-restored selection stays unconfirmed, exactly like a deep link.
    await user.click(screen.getByTestId("add-to-cart"));
    expect(
      screen.getByRole("dialog", { name: "Confirm your options" }),
    ).toBeVisible();
    expect(cart.addItem).not.toHaveBeenCalled();
  });
});
