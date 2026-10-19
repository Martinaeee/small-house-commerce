import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("RoomSceneGallery", () => {
  it("fits a tall product card above the real bottom navigation using its measured height", () => {
    const bar = document.createElement("nav"); bar.setAttribute("data-homepage-bottom-chrome", ""); document.body.append(bar);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this === bar) return new DOMRect(0, 300, 390, 64);
      if (this.hasAttribute("data-hotspot")) return new DOMRect(100, 250, 28, 28);
      if (this.id.startsWith("room-card-")) return new DOMRect(8, 286, 240, 260);
      return new DOMRect(0, 0, 390, 300);
    });
    try {
      const product = cardTestProduct();
      const source = scene("/room.jpg"); source.hotspots = [{ productId: product.id, xPct: 50, yPct: 50, product }];
      render(<RoomSceneGallery section={{ id: "room", title: "Room" }} scenes={[source]} />);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(product.name) }));
      const popup = document.querySelector<HTMLElement>('[id^="room-card-"]')!;
      expect(Number.parseFloat(popup.style.top)).toBeLessThanOrEqual(32);
      expect(Number.parseFloat(popup.style.maxHeight)).toBe(284);
    } finally { rect.mockRestore(); bar.remove(); }
  });
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
});
