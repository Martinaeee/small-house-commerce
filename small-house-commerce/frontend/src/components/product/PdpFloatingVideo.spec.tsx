import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDesktopViewport } from "@/test/desktop-viewport";
import { PdpFloatingVideo } from "./PdpFloatingVideo";

let observers: { callback: IntersectionObserverCallback; target?: Element }[] = [];

class IntersectionObserverMock {
  root = null;
  rootMargin = "";
  thresholds = [0];
  constructor(private callback: IntersectionObserverCallback) {
    observers.push({ callback });
  }
  observe(target: Element) {
    observers.at(-1)!.target = target;
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

function setGalleryVisible(visible: boolean) {
  const gallery = document.querySelector("[data-pdp-gallery]")!;
  for (const observer of observers) {
    act(() => {
      observer.callback(
        [{ target: gallery, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
  }
}

const VIDEO = "/uploads/video/demo.mp4";

function renderWithGallery() {
  return render(
    <>
      <div data-pdp-gallery />
      <PdpFloatingVideo videoUrl={VIDEO} productName="Foldable desk" />
    </>,
  );
}

beforeEach(() => {
  observers = [];
  installDesktopViewport(false);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PdpFloatingVideo", () => {
  it("stays hidden while the hero gallery is on screen, then plays a muted mini player", async () => {
    renderWithGallery();
    expect(screen.queryByTestId("pdp-floating-video")).toBeNull();

    setGalleryVisible(false);
    await waitFor(() => expect(screen.getByTestId("pdp-floating-video")).toBeInTheDocument());
    const video = screen.getByTestId("pdp-floating-video").querySelector("video")!;
    expect(video).toHaveAttribute("src", VIDEO);
    expect(video).toHaveAttribute("loop");
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(screen.getByRole("button", { name: "Close product video" })).toBeInTheDocument();
  });

  it("closes for the rest of the session so it does not keep covering content", async () => {
    renderWithGallery();
    setGalleryVisible(false);
    await waitFor(() => expect(screen.getByTestId("pdp-floating-video")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close product video" }));
    expect(screen.queryByTestId("pdp-floating-video")).toBeNull();
    expect(sessionStorage.getItem(`luwag:pdp-floating-video-dismissed:${VIDEO}`)).toBe("1");
  });

  it("does not render on desktop or without a video", () => {
    installDesktopViewport();
    const desktop = render(
      <><div data-pdp-gallery /><PdpFloatingVideo videoUrl={VIDEO} productName="Foldable desk" /></>,
    );
    expect(desktop.container.querySelector('[data-testid="pdp-floating-video"]')).toBeNull();
    desktop.unmount();

    installDesktopViewport(false);
    const empty = render(
      <><div data-pdp-gallery /><PdpFloatingVideo videoUrl="  " productName="Foldable desk" /></>,
    );
    expect(empty.container.querySelector('[data-testid="pdp-floating-video"]')).toBeNull();
  });

  it("moves with the pointer and stays inside the viewport", async () => {
    renderWithGallery();
    setGalleryVisible(false);
    await waitFor(() => expect(screen.getByTestId("pdp-floating-video")).toBeInTheDocument());
    const card = screen.getByTestId("pdp-floating-video");
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ left: 250, top: 500, width: 132, height: 96, right: 382, bottom: 596, x: 250, y: 500, toJSON: () => ({}) } as DOMRect);
    Object.defineProperty(card, "offsetWidth", { configurable: true, value: 132 });
    Object.defineProperty(card, "offsetHeight", { configurable: true, value: 96 });

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 300, clientY: 520 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 60, clientY: 200 });
    expect(card.style.left).toBe("10px");
    expect(card.style.top).toBe("180px");

    // Dragging far past the right/bottom edges clamps to the screen.
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 9999, clientY: 9999 });
    expect(card.style.left).toBe(`${window.innerWidth - 132 - 8}px`);
    expect(card.style.top).toBe(`${window.innerHeight - 96 - 70}px`);
  });
});
