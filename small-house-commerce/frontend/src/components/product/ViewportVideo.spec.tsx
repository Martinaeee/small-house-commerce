import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { ViewportVideo } from "./ViewportVideo";
import { resetViewportPlaybackForTests } from "@/lib/viewport-video-coordinator";

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
}

let observers: ObserverRecord[] = [];

class IntersectionObserverMock {
  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    observers.push({ callback, options });
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

function intersect(
  video: HTMLVideoElement,
  rootMargin: string,
  ratio = 0.8,
): void {
  const observer = [...observers]
    .reverse()
    .find((record) => (record.options?.rootMargin ?? "0px") === rootMargin);
  if (!observer) throw new Error(`Missing observer with rootMargin ${rootMargin}`);
  act(() => {
    observer.callback(
      [
        {
          target: video,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

function enterViewport(video: HTMLVideoElement, ratio = 0.8): void {
  for (const observer of observers) {
    act(() => {
      observer.callback(
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
}

beforeEach(() => {
  observers = [];
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

  it("preloads near the viewport but waits for actual visibility to autoplay", async () => {
    render(
      <ViewportVideo
        src="/teaser.mp4"
        mode="TEASER"
        ariaLabel="Product teaser"
      />,
    );
    const video = screen.getByLabelText("Product teaser") as HTMLVideoElement;

    intersect(video, "320px 0px");

    await waitFor(() => expect(video).toHaveAttribute("src", "/teaser.mp4"));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    intersect(video, "0px");

    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1),
    );

    intersect(video, "0px", 0);

    await waitFor(() =>
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1),
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

  it("loads without autoplay when viewport observation is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <ViewportVideo
        src="/detail.mp4"
        mode="CONTENT"
        ariaLabel="Detail video"
      />,
    );
    const video = screen.getByLabelText("Detail video");

    await waitFor(() => expect(video).toHaveAttribute("src", "/detail.mp4"));
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
