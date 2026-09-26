import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProductImage } from "@/lib/api";
import { ProductGallery } from "./ProductGallery";

const media: ProductImage[] = [
  {
    id: "image-1",
    url: "/one.jpg",
    type: "IMAGE",
    altText: "First image",
    sortOrder: 0,
  },
  {
    id: "video-1",
    url: "/demo.mp4",
    type: "VIDEO",
    altText: "Demo video",
    sortOrder: 1,
  },
  {
    id: "image-2",
    url: "/two.jpg",
    type: "IMAGE",
    altText: "Second image",
    sortOrder: 2,
  },
];

function Harness() {
  const [active, setActive] = useState(0);
  return (
    <ProductGallery
      images={media}
      active={active}
      onSelect={setActive}
      onOpenLightbox={vi.fn()}
    />
  );
}

describe("ProductGallery video", () => {
  it("loads only the active video and keeps mixed-media indices stable", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const videoThumb = screen.getByRole("button", { name: "View media 2" });
    expect(videoThumb.querySelector("video")).toBeNull();
    expect(document.querySelectorAll("video")).toHaveLength(0);

    await user.click(videoThumb);

    const stageVideo = document.querySelector<HTMLVideoElement>(
      'video[data-video-mode="TEASER"]',
    );
    expect(stageVideo).not.toBeNull();
    expect(stageVideo).toHaveAccessibleName("Demo video");
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(videoThumb.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "View media 2" })).toHaveClass(
      "border-cta",
    );
  });
});
