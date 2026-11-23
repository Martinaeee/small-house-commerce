import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/order-receipt", () => ({
  fetchOrderReceipt: vi.fn(),
}));
vi.mock("@/components/tracking/PurchaseTracking", () => ({
  PurchaseTracking: () => null,
}));
vi.mock("@/components/checkout/OrderSuccessActions", () => ({
  OrderSuccessActions: () => <div data-testid="order-success-actions" />,
}));

import { fetchOrderReceipt } from "@/lib/order-receipt";
import OrderSuccessPage from "./page";

const mockedReceipt = vi.mocked(fetchOrderReceipt);

describe("order success page", () => {
  it("renders the receipt only when the signed cookie proves the order", async () => {
    mockedReceipt.mockResolvedValue({ ok: true, placedAt: "2026-11-09T06:00:00.000Z" });
    const page = await OrderSuccessPage({ params: Promise.resolve({ orderNumber: "PH100030" }) });
    render(page);

    expect(screen.getByText("Thank You!")).toBeInTheDocument();
    expect(screen.getByTestId("order-number")).toHaveTextContent("PH100030");
  });

  it("never confirms an order number without a valid receipt", async () => {
    mockedReceipt.mockResolvedValue(null);
    const page = await OrderSuccessPage({ params: Promise.resolve({ orderNumber: "PH100999" }) });
    render(page);

    expect(screen.queryByText("Thank You!")).toBeNull();
    expect(screen.queryByTestId("order-number")).toBeNull();
    expect(screen.getByRole("link", { name: /track your order/i })).toHaveAttribute(
      "href",
      "/track-order",
    );
  });

  it("falls back to the neutral page when the receipt check throws", async () => {
    mockedReceipt.mockRejectedValue(new Error("backend down"));
    const page = await OrderSuccessPage({ params: Promise.resolve({ orderNumber: "PH100030" }) });
    render(page);

    expect(screen.queryByText("Thank You!")).toBeNull();
  });
});
