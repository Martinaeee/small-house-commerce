import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HydratedRoomScene } from "@/lib/api";
import { RoomSceneStack } from "./RoomSceneStack";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
}));

const product = (id: string, name: string, slug: string) => ({
  id,
  name,
  slug,
  images: [],
  variants: [],
  price: "1000",
  currency: "PHP",
  categoryId: null,
  collectionIds: [],
  ratingAverage: null,
  reviewCount: 0,
  shortDescription: null,
  description: null,
  coverMedia: null,
  effectiveCoverMedia: null,
  badge: null,
  stockStatus: "IN_STOCK",
  options: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as HydratedRoomScene["hotspots"][number]["product"]);

const scenes: HydratedRoomScene[] = [
  {
    id: "scene-1",
    imageUrl: "/uploads/one.png",
    alt: "Condo living room",
    hotspots: [
      { productId: "p1", xPct: 30, yPct: 55, product: product("p1", "Narrow Gap Cabinet", "narrow-gap-cabinet") },
      { productId: "p2", xPct: 70, yPct: 40, product: product("p2", "Slim Slide Cart", "slim-slide-cart") },
    ],
  },
  {
    id: "scene-2",
    imageUrl: "/uploads/two.png",
    hotspots: [
      { productId: "p3", xPct: 50, yPct: 50, product: product("p3", "Rolling Stool", "rolling-stool") },
    ],
  },
];

describe("RoomSceneStack", () => {
  it("stacks every scene vertically with its own numbered markers", () => {
    render(
      <RoomSceneStack
        section={{ id: "rooms", title: "Room Inspiration" }}
        scenes={scenes}
      />,
    );

    const blocks = document.querySelectorAll("[data-room-scene]");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].getAttribute("data-room-scene")).toBe("scene-1");
    expect(blocks[1].getAttribute("data-room-scene")).toBe("scene-2");

    expect(screen.getByRole("button", { name: "View product: Narrow Gap Cabinet" })).toBeVisible();
    expect(screen.getByRole("button", { name: "View product: Rolling Stool" })).toBeVisible();
    // Each scene numbers its own markers from one.
    expect(screen.getByRole("button", { name: "View product: Slim Slide Cart" }).textContent).toBe("2");
    expect(screen.getByRole("button", { name: "View product: Rolling Stool" }).textContent).toBe("1");
  });

  it("links every scene product to its product page", () => {
    render(
      <RoomSceneStack
        section={{ id: "rooms", title: "Room Inspiration" }}
        scenes={scenes}
      />,
    );

    expect(screen.getByRole("link", { name: /Narrow Gap Cabinet/ })).toHaveAttribute(
      "href",
      "/products/narrow-gap-cabinet",
    );
    expect(screen.getByRole("link", { name: /Rolling Stool/ })).toHaveAttribute(
      "href",
      "/products/rolling-stool",
    );
  });

  it("marks the matching product card when a marker is tapped", () => {
    render(
      <RoomSceneStack
        section={{ id: "rooms", title: "Room Inspiration" }}
        scenes={scenes}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View product: Slim Slide Cart" }));

    const card = document.querySelector('[data-room-product-card="scene-1-1"]');
    expect(card?.getAttribute("data-active")).toBe("true");
    const other = document.querySelector('[data-room-product-card="scene-1-0"]');
    expect(other?.getAttribute("data-active")).toBe("false");
  });
});
