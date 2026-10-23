import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BackToTop } from "./BackToTop";

vi.mock("next/navigation", () => ({
  usePathname: () => "/products/chair",
}));

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: 1000,
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BackToTop", () => {
  it("uses a filled, high-contrast control once the shopper scrolls", () => {
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    render(<BackToTop />);
    fireEvent.scroll(window);

    const button = screen.getByRole("button", { name: "Back to top" });
    expect(button).toHaveAttribute("aria-hidden", "false");
    for (const cls of ["bg-cta", "text-cta-foreground", "h-12", "w-12", "shadow-xl"]) {
      expect(button.classList.contains(cls)).toBe(true);
    }

    fireEvent.click(button);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
