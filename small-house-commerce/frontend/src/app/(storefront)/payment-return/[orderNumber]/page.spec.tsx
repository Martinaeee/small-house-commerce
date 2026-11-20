import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import PaymentReturnPage, { metadata } from "./page";

vi.mock("@/components/checkout/PaymentReturnClient", () => ({
  PaymentReturnClient: ({ orderNumber }: { orderNumber: string }) => (
    <div data-testid="payment-return-client">{orderNumber}</div>
  ),
}));

describe("payment return page", () => {
  it("asks the engine not to index the payment page", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("hands the order number to the client and nothing else", async () => {
    const element = await PaymentReturnPage({
      params: Promise.resolve({ orderNumber: "PH100030" }),
    });
    const { getByTestId } = render(element);

    expect(getByTestId("payment-return-client")).toHaveTextContent("PH100030");
  });
});
