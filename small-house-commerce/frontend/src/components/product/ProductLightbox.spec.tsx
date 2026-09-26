import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ProductImage } from "@/lib/api";
import {
  registerViewportPlayback,
  resetViewportPlaybackForTests,
} from "@/lib/viewport-video-coordinator";
import { ProductLightbox } from "./ProductLightbox";

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
];

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      media: "(min-width: 1024px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

afterEach(() => {
  cleanup();
  resetViewportPlaybackForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProductLightbox video", () => {
  it("suspends viewport playback and renders video as controlled lightbox media", async () => {
    const winner = document.createElement("video");
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    Object.defineProperties(winner, {
      play: { configurable: true, value: play },
      pause: { configurable: true, value: pause },
    });
    const registration = registerViewportPlayback({
      id: "page-winner",
      element: winner,
      mode: "TEASER",
    });
    registration.update({ eligible: true, intersectionRatio: 0.9 });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));

    const view = render(
      <ProductLightbox
        images={media}
        productName="Mixed product"
        index={1}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    const lightboxVideo = document.querySelector<HTMLVideoElement>(
      'video[data-video-mode="LIGHTBOX"]',
    );
    expect(lightboxVideo).not.toBeNull();
    expect(lightboxVideo).toHaveAttribute("src", "/demo.mp4");
    expect(lightboxVideo).toHaveAttribute("controls");
    expect(lightboxVideo).toHaveAccessibleName("Demo video");
    expect(document.querySelector('img[src="/demo.mp4"]')).toBeNull();
    expect(screen.getByRole("dialog", { name: "Product image gallery" })).toBeVisible();

    view.unmount();
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    registration.unregister();
  });
});
