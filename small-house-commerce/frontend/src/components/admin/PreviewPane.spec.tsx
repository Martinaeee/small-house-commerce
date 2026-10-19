import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceFrame } from "@/components/admin/PreviewPane";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DeviceFrame Studio fit", () => {
  it("fits a fixed desktop viewport into both available axes only when opted in", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 600, height: 270 } as DOMRect);
    render(<DeviceFrame device="desktop" fitAvailable><div>Content</div></DeviceFrame>);
    const viewport = document.querySelector<HTMLElement>("[data-preview-viewport]");
    expect(viewport).toHaveStyle({ width: "1440px", height: "900px", transform: "scale(0.3)" });
  });

  it("observes the allocated host, reacts to both axes, and ignores hidden or invalid measurements", () => {
    let notify: ResizeObserverCallback = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 600, height: 270 } as DOMRect);
    const metrics = vi.fn();
    const mounted = render(<DeviceFrame device="desktop" fitAvailable onMetricsChange={metrics}><div>Content</div></DeviceFrame>);
    const host = document.querySelector("[data-preview-host]");
    const viewport = document.querySelector<HTMLElement>("[data-preview-viewport]")!;
    expect(host).not.toBeNull();
    expect(observe).toHaveBeenCalledWith(host);
    expect(observe).not.toHaveBeenCalledWith(document.querySelector("[data-preview-frame]"));
    const resize = (width: number, height: number): void => {
      act(() => notify([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver));
    };
    resize(500, 200);
    expect(Number(viewport.style.transform.slice(6, -1))).toBeCloseTo(0.2222222222);
    expect(viewport).toHaveStyle({ width: "1440px", height: "900px" });
    const last = metrics.mock.calls.at(-1)?.[0];
    expect(last).toEqual({ width: 1440, height: 900, scale: 200 / 900 });
    metrics.mockClear();
    for (const [width, height] of [[0, 0], [500, 0], [-1, 200], [Infinity, 200], [500, NaN]]) resize(width, height);
    expect(Number(viewport.style.transform.slice(6, -1))).toBeCloseTo(0.2222222222);
    expect(metrics).not.toHaveBeenCalled();
    mounted.rerender(<DeviceFrame device="desktop" fitAvailable onMetricsChange={metrics}><div>Updated content</div></DeviceFrame>);
    expect(metrics).not.toHaveBeenCalled();
    mounted.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("retains legacy width-only caps outside Studio", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 600, height: 270 } as DOMRect);
    render(<DeviceFrame device="desktop"><div>Content</div></DeviceFrame>);
    expect(document.querySelector("[data-preview-viewport]")).toHaveStyle({ transform: "scale(0.4166666666666667)" });
    expect(document.querySelector("[data-preview-host]")).toBeNull();
  });

  it.each(["tablet", "mobile"] as const)("can enlarge %s up to its real viewport without an old thumbnail cap", (device) => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 2000, height: 2000 } as DOMRect);
    render(<DeviceFrame device={device} fitAvailable>{null}</DeviceFrame>);
    expect(document.querySelector("[data-preview-viewport]")).toHaveStyle({ transform: "scale(1)" });
  });
});

describe("DeviceFrame metrics label", () => {
  it("reports the real device width and the scale the frame actually applied", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 195,
    } as DOMRect);

    render(
      <DeviceFrame
        device="mobile"
        flat
        scrollable
        showMetrics
        metricsTemplate="Scaled editing preview · {width}px · {scale}%"
      >
        <div>Preview content</div>
      </DeviceFrame>,
    );

    const viewport = document.querySelector<HTMLElement>("[data-preview-viewport]");
    expect(viewport?.style.width).toBe("390px");
    expect(viewport?.style.transform).toBe("scale(0.5)");
    expect(
      screen.getByText("Scaled editing preview · 390px · 50%"),
    ).toBeVisible();
  });

  it("stays hidden when the caller does not opt in", () => {
    render(<DeviceFrame device="desktop">{null}</DeviceFrame>);

    expect(screen.queryByText(/Scaled editing preview/)).toBeNull();
  });
});
