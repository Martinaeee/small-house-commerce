import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDesktopViewport } from "@/test/desktop-viewport";
import { PdpQuickCodOrderSlot } from "./PdpQuickCodOrderSlot";

// The real chunk carries the 185KB Philippine address dataset. The gate is
// what keeps it off the phone bundle, so the test doubles the loader and
// asserts the chunk component never mounts below the desktop breakpoint.
vi.mock("next/dynamic", () => ({
  default: () => function DynamicStub() {
    return <div data-testid="quick-order-chunk" />;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PdpQuickCodOrderSlot", () => {
  it("never mounts the quick order chunk on phones and tablets", () => {
    installDesktopViewport(false);
    render(<PdpQuickCodOrderSlot />);
    expect(screen.queryByTestId("quick-order-chunk")).toBeNull();
  });

  it("mounts the quick order chunk on desktop", () => {
    installDesktopViewport(true);
    render(<PdpQuickCodOrderSlot />);
    expect(screen.getByTestId("quick-order-chunk")).toBeInTheDocument();
  });
});
