import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
