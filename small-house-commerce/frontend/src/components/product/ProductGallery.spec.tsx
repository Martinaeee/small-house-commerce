import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function giveTrackSize(track: HTMLElement, width = 300) {
  Object.defineProperty(track, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(track, "scrollLeft", {
    configurable: true,
    writable: true,
    value: 0,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ProductGallery video", () => {
  it("loads only the active video and keeps mixed-media indices stable", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const videoThumb = screen.getByRole("button", { name: "View media 2" });
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
  it("runs the swipe track edge to edge with no frame around the media", () => {
    render(<Harness />);

    const track = screen.getByRole("group", { name: "Product media" });
    const root = track.parentElement as HTMLElement;
    expect(root.className).toMatch(/-mx-4/);
    expect(root.className).toMatch(/sm:mx-0/);
    expect(track.className).toMatch(/snap-x/);
    expect(track.className).toMatch(/overflow-x-auto/);

    const firstSlide = screen.getByRole("button", { name: "Open media 1" });
    expect(firstSlide.classList.contains("border")).toBe(false);
    expect(firstSlide.classList.contains("rounded-lg")).toBe(false);
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
});

describe("ProductGallery swipe", () => {
  it("reports the next image after the carousel settles", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(
      <ProductGallery
        images={media}
        active={0}
        onSelect={onSelect}
        onOpenLightbox={vi.fn()}
      />,
    );

    const track = screen.getByRole("group", { name: "Product media" });
    giveTrackSize(track);
    (track as HTMLDivElement).scrollLeft = 300;
    fireEvent.scroll(track);
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("keeps the current image when the finger barely moved", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(
      <ProductGallery
        images={media}
        active={0}
        onSelect={onSelect}
        onOpenLightbox={vi.fn()}
      />,
    );

    const track = screen.getByRole("group", { name: "Product media" });
    giveTrackSize(track);
    (track as HTMLDivElement).scrollLeft = 40;
    fireEvent.scroll(track);
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not open the lightbox with the click that ends a swipe", () => {
    const onOpenLightbox = vi.fn();
    render(
      <ProductGallery
        images={media}
        active={0}
        onSelect={vi.fn()}
        onOpenLightbox={onOpenLightbox}
      />,
    );

    const track = screen.getByRole("group", { name: "Product media" });
    giveTrackSize(track);
    const second = screen.getByRole("button", { name: "Open media 2" });
    fireEvent.pointerDown(track);
    (track as HTMLDivElement).scrollLeft = 300;
    fireEvent.click(second);
    expect(onOpenLightbox).not.toHaveBeenCalled();

    fireEvent.pointerDown(track);
    fireEvent.click(second);
    expect(onOpenLightbox).toHaveBeenCalledWith(1);
  });
});
