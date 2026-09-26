import { useRef } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product, ProductImage } from "@/lib/api";
import { createInitialPurchaseLines } from "./PdpPurchaseProvider";
import { resolveSelection } from "@/lib/product-selection";
import { PdpStickyBuy } from "./PdpStickyBuy";

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
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function installIntersectionObserver(): ObserverHarness {
  let callback: IntersectionObserverCallback | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();

  class MockIntersectionObserver {
    constructor(next: IntersectionObserverCallback) {
      callback = next;
    }

    observe = observe;
    unobserve = vi.fn();
    disconnect = disconnect;
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "0px";
    thresholds = [0];
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

  const notify = (isIntersecting: boolean) => {
    if (!callback) throw new Error("Observer was not created");
    act(() => {
      callback?.(
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

  return {
    enter: () => notify(true),
    leave: () => notify(false),
    observe,
    disconnect,
  };
}

function Harness({
  value = product,
  coverMedia = value.effectiveCoverMedia,
  restockHref = "mailto:support@example.test?subject=Restock",
  onQuantityChange = vi.fn(),
  onIntent = vi.fn(),
}: {
  value?: Product;
  coverMedia?: ProductImage | null;
  restockHref?: string;
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
        restockHref={restockHref}
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

    observer.enter();
    expect(document.body.style.paddingBottom).toBe("");
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

  it("keeps the existing restock contact action in the out-of-stock sticky state", () => {
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
    const restockHref =
      "mailto:support@example.test?subject=Restock%20Blue%20chair";
    render(<Harness value={outOfStock} restockHref={restockHref} />);

    observer.leave();

    expect(screen.queryByTestId("sticky-order-now")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Contact us to order" }),
    ).toHaveAttribute("href", restockHref);
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
