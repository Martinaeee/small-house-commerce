import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { installDesktopViewport } from "@/test/desktop-viewport";
import { PdpQuickCodOrderSlot } from "./PdpQuickCodOrderSlot";

/**
 * The inline cash order on the product page only ever places a cash order.
 * When cash on delivery is switched off, the form must be gone — not just
 * refused at submit.
 */

vi.mock("next/dynamic", () => ({
  default: () => function DynamicStub() {
    return <div data-testid="quick-order-chunk" />;
  },
}));

const apiMock = vi.hoisted(() => ({ getPaymentMethods: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, ...apiMock } };
});

describe("PDP quick cash order and the cash switch", () => {
  it("hides the inline cash form when cash on delivery is switched off", async () => {
    apiMock.getPaymentMethods.mockResolvedValue({
      codEnabled: false,
      revision: 2,
      methods: [
        { id: "COD", enabled: false },
        { id: "CARD", enabled: true },
      ],
    });
    installDesktopViewport(true);
    render(<PdpQuickCodOrderSlot />);

    await waitFor(() => expect(apiMock.getPaymentMethods).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("quick-order-chunk")).toBeNull());
  });

  it("keeps the inline cash form when the methods cannot be read", async () => {
    apiMock.getPaymentMethods.mockRejectedValue(new Error("offline"));
    installDesktopViewport(true);
    render(<PdpQuickCodOrderSlot />);

    await waitFor(() => expect(apiMock.getPaymentMethods).toHaveBeenCalled());
    expect(screen.getByTestId("quick-order-chunk")).toBeInTheDocument();
  });

  it("keeps the inline cash form while cash on delivery is on", async () => {
    apiMock.getPaymentMethods.mockResolvedValue({
      codEnabled: true,
      revision: 1,
      methods: [{ id: "COD", enabled: true }],
    });
    installDesktopViewport(true);
    render(<PdpQuickCodOrderSlot />);

    await waitFor(() => expect(apiMock.getPaymentMethods).toHaveBeenCalled());
    expect(screen.getByTestId("quick-order-chunk")).toBeInTheDocument();
  });
});
