import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("ProductGallery phone presentation", () => {
  it("drops the stage frame and lets the phone image run edge to edge", () => {
    render(<Harness />);

    const stage = screen.getByRole("button", { name: "Open image gallery" });
    expect(stage.classList.contains("border")).toBe(false);
    expect(stage.classList.contains("rounded-lg")).toBe(false);

    // The gallery escapes the page padding on phones and returns to the
    // content column from sm up.
    const root = stage.parentElement as HTMLElement;
    expect(root.className).toMatch(/-mx-4/);
    expect(root.className).toMatch(/sm:mx-0/);
  });

  it("uses the next image behind the overflow tile instead of a flat colour", () => {
    const many: ProductImage[] = Array.from({ length: 8 }, (_, index) => ({
      id: `image-${index}`,
      url: `/image-${index}.jpg`,
      type: "IMAGE" as const,
      altText: `Image ${index}`,
      sortOrder: index,
    }));
    render(
      <ProductGallery
        images={many}
        active={0}
        onSelect={vi.fn()}
        onOpenLightbox={vi.fn()}
      />,
    );

    const tile = screen.getByRole("button", {
      name: "View all 8 photos and videos",
    });
    // Four direct thumbnails, so the tile previews the fifth image.
    expect(tile.querySelector("img")).toHaveAttribute("src", "/image-4.jpg");
    expect(tile).toHaveTextContent("+4");
    expect(tile.classList.contains("bg-primary-light/40")).toBe(false);
  });

  it("keeps the thumbnails compact on phones and full size from sm up", () => {
    render(<Harness />);

    const thumb = screen.getByRole("button", { name: "View media 1" });
    for (const cls of ["h-14", "w-14", "sm:h-20", "sm:w-20"]) {
      expect(thumb.classList.contains(cls)).toBe(true);
    }
  });

  it("swipes sideways to change the image without opening the lightbox", () => {
    const onSelect = vi.fn();
    const onOpenLightbox = vi.fn();
    render(
      <ProductGallery
        images={media}
        active={0}
        onSelect={onSelect}
        onOpenLightbox={onOpenLightbox}
      />,
    );

    const stage = screen.getByRole("button", { name: "Open image gallery" });
    fireEvent.pointerDown(stage, {
      pointerType: "touch",
      clientX: 320,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, {
      pointerType: "touch",
      clientX: 180,
      clientY: 208,
    });

    expect(onSelect).toHaveBeenCalledWith(1);
    // The click that follows the gesture must not also open the lightbox.
    fireEvent.click(stage);
    expect(onOpenLightbox).not.toHaveBeenCalled();
  });

  it("ignores a small jiggle, a vertical scroll and a mouse drag", () => {
    const onSelect = vi.fn();
    render(
      <ProductGallery
        images={media}
        active={1}
        onSelect={onSelect}
        onOpenLightbox={vi.fn()}
      />,
    );

    const stage = screen.getByRole("button", { name: "Open image gallery" });
    fireEvent.pointerDown(stage, { pointerType: "touch", clientX: 300, clientY: 200 });
    fireEvent.pointerUp(stage, { pointerType: "touch", clientX: 280, clientY: 205 });
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.pointerDown(stage, { pointerType: "touch", clientX: 300, clientY: 300 });
    fireEvent.pointerUp(stage, { pointerType: "touch", clientX: 300, clientY: 120 });
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.pointerDown(stage, { pointerType: "mouse", clientX: 320, clientY: 200 });
    fireEvent.pointerUp(stage, { pointerType: "mouse", clientX: 180, clientY: 200 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("stops at the first and last image instead of wrapping", () => {
    const first = vi.fn();
    const { unmount } = render(
      <ProductGallery images={media} active={0} onSelect={first} onOpenLightbox={vi.fn()} />,
    );
    const stage = screen.getByRole("button", { name: "Open image gallery" });
    fireEvent.pointerDown(stage, { pointerType: "touch", clientX: 180, clientY: 200 });
    fireEvent.pointerUp(stage, { pointerType: "touch", clientX: 320, clientY: 200 });
    expect(first).not.toHaveBeenCalled();
    unmount();

    const last = vi.fn();
    render(
      <ProductGallery images={media} active={2} onSelect={last} onOpenLightbox={vi.fn()} />,
    );
    const lastStage = screen.getByRole("button", { name: "Open image gallery" });
    fireEvent.pointerDown(lastStage, { pointerType: "touch", clientX: 320, clientY: 200 });
    fireEvent.pointerUp(lastStage, { pointerType: "touch", clientX: 180, clientY: 200 });
    expect(last).not.toHaveBeenCalled();
  });
});
