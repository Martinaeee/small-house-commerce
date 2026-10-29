import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { api } from "@/lib/api";
import { ProductCard } from "./ProductCard";
import { cardTestProduct } from "@/test/product-card-fixtures";

const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => ({ ...tracking, currentMarketingCredential: vi.fn(() => null) }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ProductCard without cart context", () => {
  it("renders inert preview controls with no CartProvider or navigation", () => {
    const { container } = render(<ProductCard product={cardTestProduct({ defaultDisplayVariantId: "blue-variant", cardMedia: {
      displayVariantId: "blue-variant", unselected: { cover: null, scene: null }, variants: [],
    } })}
      interactionMode="preview" navigationTrackAttrs={{ "data-home-track": "ProductClick" }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("[data-home-track]")).toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "false");
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
  });

  it.each(["priced", "unpriced", "no-sku"] as const)("shows the requested %s draft variant and updates it without mutating purchase state", availability => {
    const product = cardTestProduct();
    const pairs = product.variants.map(variant => ({ variantId: variant.id,
      cover: { id: `card:${variant.id}:cover`, type: "IMAGE" as const, url: `/${variant.name}-card.webp`, altText: `${variant.name} card`, sortOrder: 0 },
      scene: null,
    }));
    product.cardMedia = { displayVariantId: "blue-variant", unselected: pairs[1]!, variants: pairs };
    if (availability === "unpriced") product.variants[1]!.sku!.price = null;
    if (availability === "no-sku") product.variants[1]!.sku = null;
    const add = vi.spyOn(api, "addToCart");
    const view = render(<StrictMode><ProductCard product={product} interactionMode="preview" /></StrictMode>);
    expect(screen.getByRole("img", { name: "Blue card" })).toHaveAttribute("src", "/Blue-card.webp");
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    if (availability === "priced") expect(screen.getByTestId("price")).toHaveTextContent("₱120.00");
    else expect(screen.queryByTestId("price")).not.toBeInTheDocument();
    view.rerender(<StrictMode><ProductCard product={{ ...product, cardMedia: {
      displayVariantId: "red-variant", unselected: pairs[0]!, variants: pairs,
    } }} interactionMode="preview" /></StrictMode>);
    expect(screen.getByRole("img", { name: "Red card" })).toHaveAttribute("src", "/Red-card.webp");
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("price")).toHaveTextContent("₱100.00");
    fireEvent(window, new Event("resize"));
    fireEvent.load(screen.getByRole("img", { name: "Red card" }));
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it("keeps more options disabled and hover/load inert under StrictMode without cart context", () => {
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      readonly pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? "mouse"; }
    });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const product = cardTestProduct();
    const source = product.variants[0]!;
    product.options[0]!.values = Array.from({ length: 12 }, (_, index) => ({
      id: `long-${index}`, label: `Performance Multi Twill with finish ${index}`, position: index,
      swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
    }));
    product.variants = product.options[0]!.values.map(value => ({ ...source, id: `variant-${value.id}`,
      optionValueIds: [value.id], combinationKey: `color:${value.id}`, sku: { ...source.sku!, id: `sku-${value.id}` },
    }));
    const cover = { id: "preview-cover", type: "IMAGE" as const, url: "/preview-cover.webp", altText: "Preview cover", sortOrder: 0 };
    const scene = { ...cover, id: "preview-hover", url: "/preview-hover.webp" };
    product.cardMedia = { displayVariantId: product.variants[0]!.id, unselected: { cover, scene },
      variants: [{ variantId: product.variants[0]!.id, cover, scene }],
    };
    const add = vi.spyOn(api, "addToCart");
    const { container } = render(<StrictMode><ProductCard product={product} interactionMode="preview" /></StrictMode>);
    const more = screen.getByRole("button", { name: "More Color options" });
    expect(more).toBeDisabled();
    fireEvent.click(more);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.pointerOver(screen.getByRole("img", { name: "Preview cover" }).parentElement!, { pointerType: "mouse" });
    const hover = container.querySelector("[data-card-scene]");
    expect(hover).not.toBeNull();
    fireEvent.load(hover!);
    expect(hover).toHaveAttribute("data-visible", "true");
    expect(add).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not mount a live restock trigger for an out-of-stock preview SKU", () => {
    const product = cardTestProduct({
      defaultDisplayVariantId: "blue-variant",
      cardMedia: {
        displayVariantId: "blue-variant",
        unselected: { cover: null, scene: null },
        variants: [],
      },
    });
    product.variants[1]!.sku!.availableInventory = 0;
    const request = vi.spyOn(globalThis, "fetch");

    render(<ProductCard product={product} interactionMode="preview" />);

    expect(
      screen.queryByRole("button", { name: "Notify me when back in stock" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not fall back to a details link for an unavailable preview product", () => {
    const product = cardTestProduct();
    product.variants.forEach(variant => { variant.sku!.status = "DISABLED"; });
    render(<ProductCard product={product} interactionMode="preview" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeDisabled();
    expect(tracking.track).not.toHaveBeenCalled();
  });
});
