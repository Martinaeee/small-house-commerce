import { useRef } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product, ProductImage } from "@/lib/api";
import { createInitialPurchaseLines } from "./PdpPurchaseProvider";
import { resolveSelection } from "@/lib/product-selection";
import { PdpStickyBuy } from "./PdpStickyBuy";

vi.mock("@/components/site/SiteSettingsProvider", () => ({
  useSiteSettings: () => ({ backInStockEnabled: true }),
}));

const product = {
  id: "sticky-product",
  name: "Folding Chair",
  slug: "folding-chair",
  defaultDisplayVariantId: "chair-black",
  effectiveCoverMedia: {
    id: "cover",
    url: "/chair.jpg",
    type: "IMAGE",
    altText: "Black folding chair",
    sortOrder: 0,
  },
  images: [],
  options: [],
  variants: [
    {
      id: "chair-black",
      name: "Black",
      position: 0,
      combinationKey: "",
      optionValueIds: [],
      sku: {
        id: "chair-sku",
        skuCode: "CHAIR-BLACK",
        status: "ACTIVE",
        price: 899,
        compareAtPrice: 999,
        availableInventory: 6,
      },
    },
  ],
} as unknown as Product;

interface ObserverHarness {
  enter(): void;
  leave(): void;
  enterCod(): void;
  leaveCod(): void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function installIntersectionObserver(): ObserverHarness {
  const observed: Element[] = [];
  const callbacks = new Map<Element, IntersectionObserverCallback>();
  const observe = vi.fn();
  const disconnect = vi.fn();

  class MockIntersectionObserver {
    callback: IntersectionObserverCallback;

    constructor(next: IntersectionObserverCallback) {
      this.callback = next;
    }

    observe = (target: Element) => {
      observe(target);
      observed.push(target);
      callbacks.set(target, this.callback);
    };
    unobserve = vi.fn();
    disconnect = disconnect;
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "0px";
    thresholds = [0];
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

  const notify = (target: Element | undefined, isIntersecting: boolean) => {
    if (!target) throw new Error("Observer target was not registered");
    const callback = callbacks.get(target);
    if (!callback) throw new Error("Observer was not created for the target");
    act(() => {
      callback(
        [
          {
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
  };

  const heroTarget = (): Element | undefined =>
    observed.find((element) => element.id !== "quick-cod-order");
  const codTarget = (): Element | undefined =>
    observed.find((element) => element.id === "quick-cod-order");

  return {
    enter: () => notify(heroTarget(), true),
    leave: () => notify(heroTarget(), false),
    enterCod: () => notify(codTarget(), true),
    leaveCod: () => notify(codTarget(), false),
    observe,
    disconnect,
  };
}

function Harness({
  value = product,
  coverMedia = value.effectiveCoverMedia,
  onQuantityChange = vi.fn(),
  onIntent = vi.fn(),
}: {
  value?: Product;
  coverMedia?: ProductImage | null;
  onQuantityChange?: (quantity: number) => void;
  onIntent?: (
    intent: "ADD_TO_CART" | "ORDER_NOW",
    trigger: HTMLElement,
  ) => void;
}) {
  const heroRef = useRef<HTMLDivElement>(null);
  const line = createInitialPurchaseLines(value)[0]!;
  const derived = resolveSelection(value, line);

  return (
    <>
      <div ref={heroRef}>Hero</div>
      <PdpStickyBuy
        product={value}
        coverMedia={coverMedia}
        heroRef={heroRef}
        line={line}
        derived={derived}
        busy={false}
        variantLabel="Black"
        onQuantityChange={onQuantityChange}
        onIntent={onIntent}
      />
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.style.paddingBottom = "";
  document.documentElement.style.removeProperty("--sticky-bar-offset");
});

describe("PdpStickyBuy", () => {
  it("stays hidden while the hero intersects and shows one responsive shared-action bar after it leaves", () => {
    const observer = installIntersectionObserver();
    render(<Harness />);

    expect(observer.observe).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("sticky-buy")).not.toBeInTheDocument();

    observer.leave();

    const bar = screen.getByTestId("sticky-buy");
    expect(bar).toHaveTextContent("Folding Chair");
    expect(bar).toHaveTextContent("Black");
    expect(bar).toHaveTextContent("₱899.00");
    expect(screen.getByTestId("sticky-order-now")).toBeVisible();
    expect(screen.getByTestId("sticky-add-to-cart")).toBeVisible();
    expect(bar.className).toContain("motion-reduce:");

    observer.enter();
    expect(screen.queryByTestId("sticky-buy")).not.toBeInTheDocument();
  });

  it("yields while the inline COD section is in view and returns after it leaves", () => {
    const observer = installIntersectionObserver();
    render(
      <>
        <Harness />
        <section id="quick-cod-order">COD</section>
      </>,
    );

    observer.leave();
    expect(screen.getByTestId("sticky-buy")).toBeVisible();

    // The COD card carries its own selection + submit, so the fixed bar must
    // not stack a second purchase UI over it.
    observer.enterCod();
    expect(screen.queryByTestId("sticky-buy")).not.toBeInTheDocument();

    observer.leaveCod();
    expect(screen.getByTestId("sticky-buy")).toBeVisible();
  });

  it("reserves the bar's measured height on the document at every width", () => {
    const observer = installIntersectionObserver();
    render(<Harness />);
    observer.leave();

    const bar = screen.getByTestId("sticky-buy");
    const rect = {
      height: 72,
      width: 1440,
      top: 828,
      left: 0,
      right: 1440,
      bottom: 900,
      x: 0,
      y: 828,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect);

    // Desktop widths used to be excluded, which left the footer underneath.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));

    expect(document.body.style.paddingBottom).toBe("72px");
    // The floating support bubble rides above the bar instead of covering the
    // actions, so the bar publishes its height while it is on screen.
    expect(
      document.documentElement.style.getPropertyValue("--sticky-bar-offset"),
    ).toBe("72px");

    observer.enter();
    expect(document.body.style.paddingBottom).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--sticky-bar-offset"),
    ).toBe("");
  });

  it("uses the currently resolved gallery image instead of the product's initial cover", () => {
    const observer = installIntersectionObserver();
    const scopedCover: ProductImage = {
      id: "blue-cover",
      url: "/chair-blue.jpg",
      type: "IMAGE",
      altText: "Blue folding chair",
      sortOrder: 0,
    };
    render(<Harness coverMedia={scopedCover} />);

    observer.leave();

    expect(
      screen.getByRole("img", { name: "Blue folding chair" }),
    ).toHaveAttribute("src", "/chair-blue.jpg");
    expect(
      screen.queryByRole("img", { name: "Black folding chair" }),
    ).toBeNull();
  });

  it("subscribes the currently resolved out-of-stock sticky SKU", async () => {
    const observer = installIntersectionObserver();
    const outOfStock = {
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        sku: variant.sku
          ? { ...variant.sku, availableInventory: 0 }
          : null,
      })),
    } as Product;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Harness value={outOfStock} />);

    observer.leave();

    expect(screen.queryByTestId("sticky-order-now")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Notify me when back in stock" }),
    );
    await user.type(screen.getByLabelText("Email address"), "sticky@example.com");
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/storefront/back-in-stock",
      expect.objectContaining({
        body: JSON.stringify({
          email: "sticky@example.com",
          skuId: "chair-sku",
        }),
      }),
    );
  });

  it("keeps the summary and both actions on one row that never scrolls sideways on phones", () => {
    // Two 120px actions plus a price block used to overflow a 375px bar, so
    // the row scrolled and ADD TO CART sat off-screen. The phone layout now
    // has three compact zones; only wider layouts keep the overflow escape.
    const observer = installIntersectionObserver();
    render(<Harness />);
    observer.leave();

    const row = screen.getByTestId("sticky-buy").firstElementChild as HTMLElement;
    expect(row.className).toMatch(/\bsm:overflow-x-auto\b/);
    expect(row.className).not.toMatch(/(^|\s)overflow-x-auto(\s|$)/);

    const summary = row.firstElementChild as HTMLElement;
    expect(summary.className).toMatch(/\bsm:hidden\b/);
    expect(summary.className).toMatch(/\bflex-1\b/);
    expect(summary.textContent).toContain("Folding Chair");
    expect(summary.textContent).toContain("₱899.00");

    for (const testId of ["sticky-order-now", "sticky-add-to-cart"]) {
      const className = screen.getByTestId(testId).className;
      expect(className).toMatch(/\bshrink-0\b/);
      expect(className).toMatch(/\bwhitespace-nowrap\b/);
      // Compact phone size; the full 120px minimum returns from sm up.
      expect(className).toContain("sm:min-w-[120px]");
    }
  });

  it("shortens the phone summary to the first three words of the name", () => {
    const observer = installIntersectionObserver();
    const longName = {
      ...product,
      name: "Narrow Gap Cabinet with Adjustable Shelves & Clear Door",
    } as Product;
    render(<Harness value={longName} />);
    observer.leave();

    const row = screen.getByTestId("sticky-buy").firstElementChild as HTMLElement;
    const summary = row.firstElementChild as HTMLElement;
    expect(summary.textContent).toContain("Narrow Gap Cabinet");
    expect(summary.textContent).not.toContain("Adjustable");
  });

  it("keeps the phone summary to one price and moves the badge to wider layouts", () => {
    // The compare-at price and the OFF badge are the widest parts of the price
    // block; on a phone the compact summary shows the price alone.
    const observer = installIntersectionObserver();
    render(<Harness />);
    observer.leave();

    const summary = screen.getByTestId("sticky-buy").firstElementChild
      ?.firstElementChild as HTMLElement;
    expect(summary.textContent).toContain("₱899.00");
    expect(summary.textContent).not.toContain("₱999.00");

    const strike = screen.getByText("₱999.00");
    expect(strike.className).toMatch(/line-through/);
    // PriceBox root -> the responsive price block.
    const priceBlock = strike.parentElement?.parentElement as HTMLElement;
    expect(priceBlock.className).toMatch(/\bhidden\b/);
    expect(priceBlock.className).toMatch(/\bsm:block\b/);

    const badge = screen.getByText(/OFF$/);
    expect(badge.className).toMatch(/\bhidden\b/);
    expect(badge.className).toMatch(/\bsm:inline\b/);
  });

  it("forwards quantity and both purchase intents without owning purchase state", async () => {
    const observer = installIntersectionObserver();
    const onQuantityChange = vi.fn();
    const onIntent = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        onQuantityChange={onQuantityChange}
        onIntent={onIntent}
      />,
    );
    observer.leave();

    await user.click(screen.getByRole("button", { name: "Increase sticky quantity" }));
    expect(onQuantityChange).toHaveBeenCalledWith(2);

    await user.click(screen.getByTestId("sticky-order-now"));
    expect(onIntent).toHaveBeenCalledWith("ORDER_NOW", expect.any(HTMLElement));

    await user.click(screen.getByTestId("sticky-add-to-cart"));
    expect(onIntent).toHaveBeenCalledWith("ADD_TO_CART", expect.any(HTMLElement));
  });

  it("fails closed without IntersectionObserver support", () => {
    vi.stubGlobal("IntersectionObserver", undefined);

    expect(() => render(<Harness />)).not.toThrow();
    expect(screen.queryByTestId("sticky-buy")).not.toBeInTheDocument();
  });
});
