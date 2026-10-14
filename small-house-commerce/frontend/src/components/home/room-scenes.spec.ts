import { describe, expect, it } from "vitest";
import { parseScenes } from "@/components/home/room-scenes";

describe("parseScenes", () => {
  it("drops scenes whose image URL is empty", () => {
    expect(
      parseScenes({
        scenes: [
          { id: "empty-scene", imageUrl: "", hotspots: [] },
          { id: "valid-scene", imageUrl: "/uploads/room.jpg", hotspots: [] },
        ],
      }),
    ).toEqual([
      {
        id: "valid-scene",
        imageUrl: "/uploads/room.jpg",
        hotspots: [],
      },
    ]);
  });
});
