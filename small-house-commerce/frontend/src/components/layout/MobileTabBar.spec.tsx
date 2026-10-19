import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "./MobileTabBar";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); route.pathname = "/"; });

describe("homepage bottom navigation clearance", () => {
  it("reserves the measured bar height once and follows later font or safe-area changes", () => {
    let height = 96;
    let notify = () => {};
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function(this: HTMLElement) {
      return this.hasAttribute("data-homepage-bottom-chrome") ? height : 0;
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notify = callback; }
      observe() {} disconnect() {}
    });
    const { container } = render(<MobileTabBar />);
    expect(container.querySelectorAll("[data-homepage-bottom-clearance]")).toHaveLength(1);
    const spacer = container.querySelector<HTMLElement>("[data-homepage-bottom-clearance]")!;
    expect(spacer.style.height).toBe("96px");
    act(() => { height = 118; notify(); });
    expect(spacer.style.height).toBe("118px");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });

  it("does not add homepage measurement behavior to other routes or hidden purchase flows", () => {
    route.pathname = "/collections";
    const { container, rerender } = render(<MobileTabBar />);
    expect(container.querySelector("[data-homepage-bottom-clearance]")).toBeNull();
    route.pathname = "/checkout";
    rerender(<MobileTabBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
