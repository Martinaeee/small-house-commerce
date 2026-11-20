import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentReturnClient } from "./PaymentReturnClient";
import { storePaymentSession } from "@/lib/paymentSession";

/**
 * The payment return page: it asks the server what happened to the order
 * and shows nothing but the server's answer. Only a verified PAID counts as
 * paid, and only that fires the Purchase event.
 */

const apiMock = vi.hoisted(() => ({
  getPaymentStatus: vi.fn(),
  retryPayment: vi.fn(),
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, ...apiMock } };
});

const useCartMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/cart/CartContext", () => ({ useCart: useCartMock }));

vi.mock("next/script", async () => {
  const React = await import("react");
  function MockScript({ onLoad }: { onLoad?: () => void }) {
    React.useEffect(() => {
      onLoad?.();
    }, [onLoad]);
    return null;
  }
  return { default: MockScript };
});

const purchaseTrackingMock = vi.hoisted(() => ({ fired: [] as string[] }));
vi.mock("@/components/tracking/PurchaseTracking", () => ({
  PurchaseTracking: ({ orderNumber }: { orderNumber: string }) => {
    purchaseTrackingMock.fired.push(orderNumber);
    return <div data-testid="purchase-tracking" />;
  },
}));

const purchasePayloadMock = vi.hoisted(() => ({ stored: [] as unknown[] }));
vi.mock("@/lib/commerce-events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/commerce-events")>(
    "@/lib/commerce-events",
  );
  return {
    ...actual,
    storePurchasePayload: (event: unknown, consent: boolean) => {
      purchasePayloadMock.stored.push({ event, consent });
      return true;
    },
  };
});

const STATUS = {
  orderNumber: "PH100030",
  paymentStatus: "ONLINE_PENDING",
  attemptStatus: "PENDING",
  env: "production",
  amount: 199,
  currency: "PHP",
};

beforeEach(() => {
  vi.clearAllMocks();
  purchaseTrackingMock.fired = [];
  purchasePayloadMock.stored = [];
  useCartMock.mockReturnValue({
    cart: { items: [{ itemId: "item-1", skuId: "sku-1" }] },
    removeItems: vi.fn().mockResolvedValue(undefined),
  });
  apiMock.getPaymentStatus.mockResolvedValue(STATUS);
});

describe("PaymentReturnClient", () => {
  it("waits while the payment is still pending and fires no Purchase event", async () => {
    render(<PaymentReturnClient orderNumber="PH100030" />);

    expect(await screen.findByText(/Checking your payment/i)).toBeInTheDocument();
    expect(screen.queryByTestId("purchase-tracking")).toBeNull();
    expect(purchasePayloadMock.stored).toHaveLength(0);
  });

  it("shows the paid state and clears the cart once the server says paid", async () => {
    apiMock.getPaymentStatus.mockResolvedValue({
      ...STATUS,
      paymentStatus: "PAID",
      attemptStatus: "SUCCEEDED",
      paidAt: "2026-11-20T08:00:00.000Z",
      value: 199,
      items: [{ skuId: "sku-1", quantity: 1 }],
      metaConsent: true,
    });
    const { cart, removeItems } = useCartMock();
    render(<PaymentReturnClient orderNumber="PH100030" />);

    expect(await screen.findByText(/Payment received/i)).toBeInTheDocument();
    expect(screen.getByTestId("purchase-tracking")).toBeInTheDocument();
    await waitFor(() => expect(removeItems).toHaveBeenCalledTimes(1));
    expect(removeItems).toHaveBeenCalledWith(["item-1"]);
    expect(cart.items).toHaveLength(1);
    // The Purchase payload carries the server's facts and the consent.
    expect(purchasePayloadMock.stored).toHaveLength(1);
    expect(purchasePayloadMock.stored[0]).toMatchObject({ consent: true });
  });

  it("answers a neutral page when the cookie names nothing", async () => {
    apiMock.getPaymentStatus.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    render(<PaymentReturnClient orderNumber="PH100030" />);

    expect(await screen.findByText(/couldn't find that payment/i)).toBeInTheDocument();
    expect(screen.queryByTestId("purchase-tracking")).toBeNull();
  });

  it("offers a retry for a failed payment and refuses while it is still pending", async () => {
    apiMock.getPaymentStatus.mockResolvedValue({
      ...STATUS,
      paymentStatus: "FAILED",
    });
    apiMock.retryPayment.mockRejectedValue(
      Object.assign(new Error("PAYMENT_STILL_PENDING"), { status: 409 }),
    );
    render(<PaymentReturnClient orderNumber="PH100030" />);

    const retry = await screen.findByTestId("payment-retry");
    await userEvent.setup().click(retry);

    await waitFor(() =>
      expect(screen.getByTestId("payment-retry-error")).toHaveTextContent(
        /still being processed/i,
      ),
    );
  });

  it("keeps checking after a failed payment is retried with a card session", async () => {
    apiMock.getPaymentStatus.mockResolvedValue({
      ...STATUS,
      paymentStatus: "FAILED",
    });
    apiMock.retryPayment.mockResolvedValue({
      orderNumber: "PH100030",
      payment: {
        attemptId: "attempt-2",
        channel: "card",
        env: "production",
        paySession: "ps_new",
      },
    });
    render(<PaymentReturnClient orderNumber="PH100030" />);

    const retry = await screen.findByTestId("payment-retry");
    const before = apiMock.getPaymentStatus.mock.calls.length;
    await userEvent.setup().click(retry);

    // The retry opened a new attempt: the page must ask the server again
    // instead of waiting on a poll loop that already stopped.
    await waitFor(() =>
      expect(apiMock.getPaymentStatus.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("mounts the card form with the session and the environment the server named", async () => {
    storePaymentSession({
      paySession: "ps_secret",
      env: "production",
      orderNumber: "PH100030",
    });
    const init = vi.fn(() => ({ mount: vi.fn() }));
    (window as unknown as { SunrateCheckout?: unknown }).SunrateCheckout = { init };
    render(<PaymentReturnClient orderNumber="PH100030" />);

    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(init).toHaveBeenCalledWith({
      paySession: "ps_secret",
      env: "production",
      paymentMethods: ["card"],
    });
  });

  it("never mounts the card form without an environment", async () => {
    storePaymentSession({
      paySession: "ps_secret",
      env: "production",
      orderNumber: "PH100030",
    });
    apiMock.getPaymentStatus.mockResolvedValue({ ...STATUS, env: null });
    const init = vi.fn(() => ({ mount: vi.fn() }));
    (window as unknown as { SunrateCheckout?: unknown }).SunrateCheckout = { init };
    render(<PaymentReturnClient orderNumber="PH100030" />);

    await waitFor(() => expect(apiMock.getPaymentStatus).toHaveBeenCalled());
    expect(init).not.toHaveBeenCalled();
    expect(await screen.findByTestId("sunrate-mount-error")).toBeInTheDocument();
  });
});
