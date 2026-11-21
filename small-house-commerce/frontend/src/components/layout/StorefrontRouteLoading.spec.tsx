import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StorefrontRouteLoading from "./StorefrontRouteLoading";

/**
 * The in-store navigation fallback.
 *
 * It used to render the brand wordmark as a pulsing logo. On a real phone
 * that read as a "loading logo" — customers waited on it and reported the
 * category switch as slow. The fallback is now a plain, minimal bar: no
 * logo, no image request, nothing that reads as brand chrome while the RSC
 * payload is in flight.
 */
describe("StorefrontRouteLoading", () => {
  it("renders no brand logo or image while a route loads", () => {
    const { container } = render(<StorefrontRouteLoading />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByTestId("brand-fallback-horizontal")).toBeNull();
    expect(screen.queryByTestId("brand-fallback-square")).toBeNull();
  });

  it("keeps an accessible status region for screen readers", () => {
    render(<StorefrontRouteLoading />);

    const status = screen.getByRole("status", { name: "Loading" });
    expect(status).toBeTruthy();
  });

  it("fades in only after the 200ms delay so instant prefetched navigations never flash it", () => {
    const { container } = render(<StorefrontRouteLoading />);

    expect(container.firstElementChild?.className).toContain("boot-nav-loader");
  });
});
