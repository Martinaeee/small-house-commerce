import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductCardMediaPair } from "@/lib/api";
import { ProductCardImage } from "./ProductCardImage";

const pair: ProductCardMediaPair = {
  cover: { id: "cover", url: "/cover.webp", type: "IMAGE", altText: "Cover", sortOrder: 0 },
  scene: { id: "scene", url: "/scene.webp", type: "IMAGE", altText: "Scene", sortOrder: 1 },
};

function hoverCapability(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}

function enter(region: HTMLElement, pointerType = "mouse") {
  fireEvent.pointerOver(region, { pointerType });
}

function leave(region: HTMLElement) {
  fireEvent.pointerOut(region, { pointerType: "mouse", relatedTarget: document.body });
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  });
  hoverCapability(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProductCardImage", () => {
  it("keeps the image frame square and the cover uncropped", () => {
    render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    expect(screen.getByRole("link")).toHaveClass("aspect-square");
    expect(screen.getByAltText("Cover")).toHaveClass("object-contain");
  });

  it("never previews a hover image when the cover is missing", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={{ cover: null, scene: pair.scene }} href="/products/chair" />);
    enter(screen.getByRole("link"));
    expect(container.querySelector("[data-card-scene]")).toBeNull();
    expect(screen.getByText("Chair")).toBeInTheDocument();
  });

  it("removes fade-out when returning to the cover", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    enter(screen.getByRole("link"));
    const scene = container.querySelector("[data-card-scene]")!;
    fireEvent.load(scene);
    expect(scene).toHaveAttribute("data-visible", "true");
    leave(screen.getByRole("link"));
    expect(scene).toHaveAttribute("data-visible", "false");
    expect(scene).toHaveClass("transition-none");
  });
  it("loads a scene only on image-region hover and displays it only after a successful load", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    const region = screen.getByRole("link");
    expect(container.querySelector("[data-card-scene]")).toBeNull();
    enter(region);
    const scene = container.querySelector<HTMLImageElement>("[data-card-scene]");
    expect(scene).not.toBeNull();
    expect(scene).toHaveAttribute("src", "/scene.webp");
    expect(scene).toHaveAttribute("data-visible", "false");
    fireEvent.load(scene!);
    expect(scene).toHaveAttribute("data-visible", "true");
    leave(region);
    expect(scene).toHaveAttribute("data-visible", "false");
    expect(screen.getByAltText("Cover")).toHaveAttribute("src", "/cover.webp");
  });

  it.each(["touch", "pen"])("does not create a scene for %s pointer input", pointerType => {
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    enter(screen.getByRole("link"), pointerType);
    expect(container.querySelector("[data-card-scene]")).toBeNull();
  });

  it("does not create a scene when hover and fine pointer are unavailable", () => {
    hoverCapability(false);
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    enter(screen.getByRole("link"));
    expect(container.querySelector("[data-card-scene]")).toBeNull();
  });

  it.each(["Scene", null, ""])("uses the stored scene alt or product name for alt %s", alt => {
    const media = { cover: pair.cover, scene: { ...pair.scene!, altText: alt } };
    const { container } = render(<ProductCardImage productName="Chair" media={media} href="/products/chair" />);
    enter(screen.getByRole("link"));
    expect(container.querySelector("[data-card-scene]")).toHaveAttribute("alt", alt || "Chair");
  });

  it("keeps the cover visible after a scene image fails", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    enter(screen.getByRole("link"));
    const scene = container.querySelector<HTMLImageElement>("[data-card-scene]");
    expect(scene).not.toBeNull();
    fireEvent.error(scene!);
    fireEvent.load(scene!);
    expect(scene).toHaveAttribute("data-visible", "false");
    expect(screen.getByAltText("Cover")).toHaveAttribute("src", "/cover.webp");
  });

  it("does not reactivate a scene when its load arrives after pointer leave", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    const region = screen.getByRole("link");
    enter(region);
    const scene = container.querySelector<HTMLImageElement>("[data-card-scene]");
    expect(scene).not.toBeNull();
    leave(region);
    fireEvent.load(scene!);
    expect(scene).toHaveAttribute("data-visible", "false");
  });

  it("isolates loading state by scene URL when the selected variant changes", () => {
    const { container, rerender } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    enter(screen.getByRole("link"));
    const oldScene = container.querySelector<HTMLImageElement>("[data-card-scene]");
    expect(oldScene).not.toBeNull();
    fireEvent.load(oldScene!);
    expect(oldScene).toHaveAttribute("data-visible", "true");
    rerender(<ProductCardImage productName="Chair" href="/products/chair?variant=blue" media={{
      cover: { id: "blue", url: "/blue.webp", type: "IMAGE", altText: "Blue", sortOrder: 0 },
      scene: { id: "blue-scene", url: "/blue-scene.webp", type: "IMAGE", altText: "Blue room", sortOrder: 1 },
    }} />);
    fireEvent.load(oldScene!);
    expect(container.querySelector('[data-card-scene][src="/scene.webp"]')).toBeNull();
    const currentScene = container.querySelector<HTMLImageElement>("[data-card-scene]");
    expect(currentScene).not.toBeNull();
    expect(currentScene).toHaveAttribute("data-visible", "false");
    enter(screen.getByRole("link"));
    const blueScene = container.querySelector<HTMLImageElement>("[data-card-scene]");
    expect(blueScene).toHaveAttribute("src", "/blue-scene.webp");
    expect(blueScene).toHaveAttribute("data-visible", "false");
    fireEvent.load(blueScene!);
    expect(blueScene).toHaveAttribute("data-visible", "true");
  });

  it("does not reuse loading or failure state when returning to an older variant URL", () => {
    const { container, rerender } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    enter(screen.getByRole("link"));
    const original = container.querySelector<HTMLImageElement>("[data-card-scene]")!;
    fireEvent.load(original);
    rerender(<ProductCardImage productName="Chair" media={{ cover: pair.cover, scene: { ...pair.scene!, url: "/blue-scene.webp" } }} href="/products/chair?variant=blue" />);
    const blue = container.querySelector<HTMLImageElement>("[data-card-scene]")!;
    rerender(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    const returned = container.querySelector<HTMLImageElement>("[data-card-scene]")!;
    expect(returned).not.toBe(original);
    expect(returned).toHaveAttribute("data-visible", "false");
    fireEvent.load(blue);
    fireEvent.error(original);
    expect(returned).toHaveAttribute("data-visible", "false");
    fireEvent.load(returned);
    expect(returned).toHaveAttribute("data-visible", "true");
    fireEvent.error(blue);
    expect(returned).toHaveAttribute("data-visible", "true");
  });

  it("supports focus-visible keyboard preview even without a fine pointer", () => {
    hoverCapability(false);
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    const region = screen.getByRole("link");
    vi.spyOn(region, "matches").mockImplementation(selector => selector === ":focus-visible");
    fireEvent.focus(region);
    const scene = container.querySelector<HTMLImageElement>("[data-card-scene]");
    expect(scene).not.toBeNull();
    fireEvent.load(scene!);
    expect(scene).toHaveAttribute("data-visible", "true");
    fireEvent.blur(region);
    expect(scene).toHaveAttribute("data-visible", "false");
  });

  it("does not create a keyboard preview for pointer-produced focus", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
    const region = screen.getByRole("link");
    vi.spyOn(region, "matches").mockReturnValue(false);
    fireEvent.focus(region);
    expect(container.querySelector("[data-card-scene]")).toBeNull();
  });

  it.each(["missing", "same-url"])("does not request a redundant scene when it is %s", kind => {
    const media = { cover: pair.cover, scene: kind === "missing" ? null : { ...pair.scene!, url: "/cover.webp" } };
    const { container } = render(<ProductCardImage productName="Chair" media={media} href="/products/chair" />);
    enter(screen.getByRole("link"));
    expect(container.querySelector("[data-card-scene]")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("keeps previews non-navigable and leaves navigation tracking off non-links", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={pair} href={null}
      navigationTrackAttrs={{ "data-home-track": "ProductClick" }}><span>New</span></ProductCardImage>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("[data-home-track]")).toBeNull();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("puts tracking and the variant deep link on the actual image link", () => {
    render(<ProductCardImage productName="Chair" media={pair} href="/products/chair?variant=blue"
      navigationTrackAttrs={{ "data-home-track": "ProductClick" }} />);
    expect(screen.getByRole("link", { name: "Chair" })).toHaveAttribute("href", "/products/chair?variant=blue");
    expect(screen.getByRole("link")).toHaveAttribute("data-home-track", "ProductClick");
  });

  it("keeps a labeled image region without an img when the winning scope has no image", () => {
    const { container } = render(<ProductCardImage productName="Chair" media={{ cover: null, scene: null }} href="/products/chair" />);
    expect(screen.getByRole("link", { name: "Chair" })).toBeInTheDocument();
    expect(screen.getByText("Chair")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
