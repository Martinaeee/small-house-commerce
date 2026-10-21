import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins", variable: "font-poppins-variable" },
}));

import { BootSplash } from "./BootSplash";
import { BootSplashAssets } from "./BootSplashAssets";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-splash-done");
  document.documentElement.removeAttribute("data-splash-slow");
  vi.unstubAllGlobals();
});

describe("BootSplash published mark protocol", () => {
  it("renders the stable decorative mark and theme variables without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <BootSplashAssets />
        <BootSplash />
      </>,
    );

    const splash = document.querySelector<HTMLElement>("#boot-splash");
    const mark = splash?.querySelector("img");
    const css = document.querySelector("#boot-splash-css")?.textContent ?? "";
    expect(mark).toHaveAttribute("src", "/brand-mark");
    expect(mark).toHaveAttribute("alt", "");
    expect(splash?.getAttribute("style")).toContain(
      "background-color: var(--color-background)",
    );
    expect(css).toContain(".boot-splash-bar{background:var(--color-cta)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains the 450ms fast/slow gate and hydrated cleanup timing", () => {
    render(
      <>
        <BootSplashAssets />
        <BootSplash />
      </>,
    );

    const init = document.querySelector("#boot-splash-init")?.textContent ?? "";
    expect(init).toContain("performance.now()<450");
    expect(init).toContain("window.setTimeout(done,400)");
    expect(init).toContain("window.setTimeout(done,3000)");
    expect(document.querySelector("#boot-splash")).not.toBeNull();

    act(() => vi.advanceTimersByTime(599));
    expect(document.querySelector("#boot-splash")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector("#boot-splash")).toBeNull();
  });
});
