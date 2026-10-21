import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { RoomSceneGallery } from "@/components/home/RoomSceneGallery";
import type { HydratedRoomScene } from "@/lib/api";

function scene(imageUrl: string): HydratedRoomScene {
  return {
    id: "scene001",
    imageUrl,
    alt: "Room scene",
    hotspots: [],
  };
}

/** A scene whose hotspots carry the given products. */
function sceneWith(imageUrl: string, products: ReturnType<typeof cardTestProduct>[]): HydratedRoomScene {
  const source = scene(imageUrl);
  source.hotspots = products.map((product, index) => ({
    productId: product.id,
    xPct: 20 + index * 30,
    yPct: 40 + index * 10,
    product,
  }));
  return source;
}

describe("RoomSceneGallery", () => {
  it("maps hotspot coordinates into an uncropped portrait image inside the 16:10 frame", () => {
    const source = scene("/portrait.jpg");
    source.hotspots = [{ productId: "chair", xPct: 0, yPct: 50, product: { id: "chair", name: "Chair" } as HydratedRoomScene["hotspots"][number]["product"] }];
    render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);
    const image = screen.getByRole("img", { name: "Room scene" });
    Object.defineProperty(image, "naturalWidth", { value: 500 });
    Object.defineProperty(image, "naturalHeight", { value: 1000 });
    fireEvent.load(image);
    const anchor = screen.getByRole("button", { name: /Chair/ }).parentElement!;
    expect(anchor.style.left).toBe("34.375%");
    expect(anchor.style.top).toBe("50%");
  });
  it("retries a scene when its image URL changes after a load failure", () => {
    const { rerender } = render(
      <RoomSceneGallery
        section={{ id: "room-section", title: "Room inspiration" }}
        scenes={[scene("/broken.jpg")]}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Room scene" }));
    expect(screen.queryByRole("img", { name: "Room scene" })).toBeNull();

    rerender(
      <RoomSceneGallery
        section={{ id: "room-section", title: "Room inspiration" }}
        scenes={[scene("/working.jpg")]}
      />,
    );

    expect(screen.getByRole("img", { name: "Room scene" })).toHaveAttribute(
      "src",
      "/working.jpg",
    );
  });

  describe("hotspot markers", () => {
    it.each([
      { device: "mobile" as const, size: "h-6 w-6" },
      { device: "tablet" as const, size: "h-7 w-7" },
      { device: "desktop" as const, size: "h-8 w-8" },
    ])("sizes the marker for the $device device", ({ device, size }) => {
      const product = cardTestProduct();
      const source = sceneWith("/room.jpg", [product]);
      render(
        <RoomSceneGallery
          section={{ id: "room", title: "Room" }}
          scenes={[source]}
          previewDevice={device}
        />,
      );
      const marker = screen.getByRole("button", { name: /Oak Side Table/ });
      expect(marker.className).toContain(size);
    });

    it("draws the marker as a white disc that carries the product's number", () => {
      const product = cardTestProduct();
      const source = sceneWith("/room.jpg", [product]);
      render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);
      const marker = screen.getByRole("button", { name: /Oak Side Table/ });
      const disc = marker.querySelector("[data-hotspot-disc]");
      expect(disc).not.toBeNull();
      expect(disc?.className).toContain("bg-white");
      expect(marker.querySelector("[data-hotspot-number]")?.textContent).toBe("1");
    });

    it("numbers the markers in the order of the scene's products", () => {
      const products = [
        cardTestProduct({ id: "p1", name: "Chair", slug: "chair" }),
        cardTestProduct({ id: "p2", name: "Lamp", slug: "lamp" }),
        cardTestProduct({ id: "p3", name: "Table", slug: "table" }),
      ];
      const source = sceneWith("/room.jpg", products);
      render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);
      const numbers = Array.from(document.querySelectorAll("[data-hotspot-number]"));
      expect(numbers.map((node) => node.textContent)).toEqual(["1", "2", "3"]);
    });

    it("labels the marker in the storefront language", () => {
      const product = cardTestProduct();
      const source = sceneWith("/room.jpg", [product]);
      render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);
      expect(
        screen.getByRole("button", { name: "View product: Oak Side Table" }),
      ).toBeTruthy();
    });
  });

  describe("product list", () => {
    it("lists the scene's products with thumbnail, name, price, rating and a product link", () => {
      const rated = cardTestProduct({
        id: "product-1",
        name: "Oak Side Table",
        slug: "oak-side-table",
        ratingAverage: 4.8,
        reviewCount: 12,
      });
      const plain = cardTestProduct({
        id: "product-2",
        name: "Woven Basket",
        slug: "woven-basket",
      });
      const source = sceneWith("/room.jpg", [rated, plain]);
      render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);

      const rows = document.querySelectorAll("[data-room-product-row]");
      expect(rows).toHaveLength(2);

      const first = rows[0] as HTMLElement;
      expect(first.querySelector("img")?.getAttribute("src")).toBe("/cover.webp");
      expect(first.textContent).toContain("Oak Side Table");
      // Real price math: two variants at different prices -> "From".
      expect(first.textContent).toContain("From ₱100.00");
      expect(first.querySelector("[data-rating-star]")).not.toBeNull();
      expect(first.textContent).toContain("(12)");
      expect(first.querySelector("a")?.getAttribute("href")).toBe("/products/oak-side-table");
      expect(first.textContent).toContain("View product");

      // A product without real reviews shows no stars, but still links out.
      const second = rows[1] as HTMLElement;
      expect(second.querySelector("[data-rating-star]")).toBeNull();
      expect(second.querySelector("a")?.getAttribute("href")).toBe("/products/woven-basket");
      expect(second.textContent).toContain("View product");
    });

    it("shows the products of the scene in view", () => {
      const callbacks: Array<(entries: unknown[]) => void> = [];
      const original = window.IntersectionObserver;
      class ControllableObserver {
        constructor(callback: (entries: unknown[]) => void) {
          callbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      }
      Object.defineProperty(window, "IntersectionObserver", {
        configurable: true,
        writable: true,
        value: ControllableObserver,
      });
      try {
        const first = sceneWith("/one.jpg", [cardTestProduct({ id: "p1", name: "Chair", slug: "chair" })]);
        first.id = "scene-one";
        const second = sceneWith("/two.jpg", [cardTestProduct({ id: "p2", name: "Lamp", slug: "lamp" })]);
        second.id = "scene-two";
        render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[first, second]} />);

        expect(document.querySelector("[data-room-product-row]")?.textContent).toContain("Chair");

        const target = document.querySelector('[data-scene-id="scene-two"]');
        act(() => {
          callbacks.forEach((callback) =>
            callback([{ isIntersecting: true, intersectionRatio: 0.9, target }]),
          );
        });

        expect(document.querySelector("[data-room-product-row]")?.textContent).toContain("Lamp");
      } finally {
        Object.defineProperty(window, "IntersectionObserver", {
          configurable: true,
          writable: true,
          value: original,
        });
      }
    });

    it("highlights the list row of the hotspot that was clicked", () => {
      const product = cardTestProduct({ id: "p1", name: "Chair", slug: "chair" });
      const source = sceneWith("/room.jpg", [product]);
      render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);

      const row = document.querySelector("[data-room-product-row]") as HTMLElement;
      expect(row.getAttribute("data-active")).toBe("false");

      fireEvent.click(screen.getByRole("button", { name: /Chair/ }));
      expect(row.getAttribute("data-active")).toBe("true");
    });

    it("numbers the product cards to match the markers", () => {
      const products = [
        cardTestProduct({ id: "p1", name: "Chair", slug: "chair" }),
        cardTestProduct({ id: "p2", name: "Lamp", slug: "lamp" }),
      ];
      const source = sceneWith("/room.jpg", products);
      render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);
      const numbers = Array.from(document.querySelectorAll("[data-room-product-number]"));
      expect(numbers.map((node) => node.textContent)).toEqual(["1", "2"]);
    });

    it("lays the products out as a horizontal rail that a phone can swipe", () => {
      const product = cardTestProduct({ id: "p1", name: "Chair", slug: "chair" });
      const source = sceneWith("/room.jpg", [product]);
      const { container } = render(
        <RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />,
      );
      const rail = container.querySelector("[data-room-product-rail]") as HTMLElement;
      expect(rail.className).toContain("overflow-x-auto");
      expect(rail.className).toContain("snap-x");
      const row = container.querySelector("[data-room-product-row]") as HTMLElement;
      expect(row.className).toContain("shrink-0");
    });

    it("scrolls the matching product card into view when its marker is clicked", () => {
      const products = [
        cardTestProduct({ id: "p1", name: "Chair", slug: "chair" }),
        cardTestProduct({ id: "p2", name: "Lamp", slug: "lamp" }),
      ];
      const source = sceneWith("/room.jpg", products);
      const calls: Array<{ el: HTMLElement; arg: unknown }> = [];
      const original = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, arg?: unknown) {
        calls.push({ el: this, arg });
      };
      try {
        render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);
        fireEvent.click(screen.getByRole("button", { name: /Lamp/ }));

        const card = document.querySelector<HTMLElement>(
          '[data-room-product-card="scene001-1"]',
        );
        expect(card).not.toBeNull();
        expect(calls.at(-1)?.el).toBe(card);
        expect(calls.at(-1)?.arg).toEqual({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      } finally {
        HTMLElement.prototype.scrollIntoView = original;
      }
    });
  });
});
