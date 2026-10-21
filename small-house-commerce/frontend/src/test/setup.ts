import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * next/font/local only exists inside the Next build — under vitest the module
 * resolves to an object whose default export is not callable, so importing
 * `@/lib/fonts` throws. Mock the font loader itself (rather than every
 * consumer of `@/lib/fonts`) so any component that reaches for a brand face
 * stays importable in unit tests.
 */
vi.mock("next/font/local", () => ({
  default: (options: { variable?: string }) => ({
    className: "font-face",
    variable: options.variable ?? "font-face-variable",
    style: {},
  }),
}));

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverStub,
});

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve() {}
}

Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  value: IntersectionObserverStub,
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: () => undefined,
});

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const dialog = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1);
    if (dialog && dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
  });
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => undefined;
}
