import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { ViewportVideo } from "./ViewportVideo";
import { resetViewportPlaybackForTests } from "@/lib/viewport-video-coordinator";

let observerCallback: IntersectionObserverCallback;

class IntersectionObserverMock {
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

function setMotionPreference(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reduced,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function setSaveData(saveData: boolean): void {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: {
      saveData,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

function enterViewport(video: HTMLVideoElement, ratio = 0.8): void {
  act(() => {
    observerCallback(
      [
        {
          target: video,
          isIntersecting: true,
          intersectionRatio: ratio,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  setMotionPreference(false);
  setSaveData(false);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetViewportPlaybackForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ViewportVideo", () => {
  it("loads near the viewport and autoplays a muted inline teaser", async () => {
    render(
      <ViewportVideo
        src="/teaser.mp4"
        mode="TEASER"
        ariaLabel="Product teaser"
        className="video"
      />,
    );
    const video = screen.getByLabelText("Product teaser") as HTMLVideoElement;

    expect(video).not.toHaveAttribute("src");
    expect(video).toHaveProperty("muted", true);
    expect(video).toHaveAttribute("playsinline");

    enterViewport(video);

    await waitFor(() => expect(video).toHaveAttribute("src", "/teaser.mp4"));
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1),
    );
  });

  it.each([
    ["reduced motion", true, false],
    ["Save-Data", false, true],
  ])("loads but does not autoplay with %s", async (_label, reduced, saveData) => {
    setMotionPreference(reduced);
    setSaveData(saveData);
    render(
      <ViewportVideo
        src="/detail.mp4"
        mode="CONTENT"
        ariaLabel="Detail video"
      />,
    );
    const video = screen.getByLabelText("Detail video") as HTMLVideoElement;

    enterViewport(video);

    await waitFor(() => expect(video).toHaveAttribute("src", "/detail.mp4"));
    expect(video).toHaveAttribute("preload", "none");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("pauses the winner while the page is hidden and resumes when visible", async () => {
    render(
      <ViewportVideo
        src="/detail.mp4"
        mode="CONTENT"
        ariaLabel="Detail video"
      />,
    );
    const video = screen.getByLabelText("Detail video") as HTMLVideoElement;
    enterViewport(video);
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1),
    );

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2),
    );
  });

  it("renders LIGHTBOX as user-controlled media without autoplay", () => {
    render(
      <ViewportVideo
        src="/full.mp4"
        mode="LIGHTBOX"
        ariaLabel="Full product video"
      />,
    );
    const video = screen.getByLabelText("Full product video");

    expect(video).toHaveAttribute("src", "/full.mp4");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "none");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});
