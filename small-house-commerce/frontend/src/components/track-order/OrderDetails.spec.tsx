import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderDetails } from "./OrderDetails";
import type { GuestOrderResult } from "@/lib/guestOrder";

/**
 * The order card a shopper sees after a successful lookup: what it shows,
 * what it withholds when only a guessable order number was given, and how
 * they reach the other orders on their number.
 */

function result(overrides: Partial<GuestOrderResult> = {}): GuestOrderResult {
  return {
    id: "order-1",
    orderNumber: "PH100006",
    orderStatus: "NEW",
    confirmationStatus: "UNCONFIRMED",
    paymentStatus: "COD_PENDING",
    currency: "PHP",
    subtotal: "2299",
    discountTotal: "99",
    shippingTotal: "0",
    grandTotal: "2200",
    createdAt: "2026-10-21T05:58:00.000Z",
    customer: {
      id: "customer-1",
      name: "Juan Dela Cruz",
      normalizedPhone: "+639171234567",
      email: null,
    },
    items: [
      {
        id: "item-1",
        productId: "product-1",
        variantId: "variant-1",
        skuId: "sku-1",
        productNameSnapshot: "Narrow Gap Cabinet with Adjustable Shelves & Clear Door",
        skuCodeSnapshot: "CAB-1",
        variantSnapshot: "Clear Door",
        optionSnapshot: null,
        quantity: 1,
        unitPrice: "2299",
        lineTotal: "2299",
        createdAt: "2026-10-21T05:58:00.000Z",
      },
    ],
    shippingAddress: {
      id: "addr-1",
      fullName: "Juan Dela Cruz",
      phone: "0917 123 4567",
      province: "Metro Manila",
      city: "Quezon City",
      barangay: "Diliman",
      postalCode: "1100",
      streetAddress: "123 Test Street",
      landmark: null,
      createdAt: "2026-10-21T05:58:00.000Z",
    },
    statusHistory: [
      {
        id: "h-1",
        statusDomain: "ORDER_STATUS",
        oldStatus: null,
        newStatus: "NEW",
        createdAt: "2026-10-21T05:58:00.000Z",
      },
      {
        id: "h-2",
        statusDomain: "ORDER_STATUS",
        oldStatus: "NEW",
        newStatus: "CONFIRMED",
        createdAt: "2026-10-21T06:30:00.000Z",
      },
    ],
    matchedBy: "phone",
    personalDetailsIncluded: true,
    otherOrders: [],
    ...overrides,
  };
}

describe("OrderDetails", () => {
  it("shows the order number, the current status and the placed date", () => {
    render(
      <OrderDetails result={result()} onTrackAnother={vi.fn()} onVerifyPhone={vi.fn()} onSelectOrder={vi.fn()} />,
    );

    expect(screen.getByTestId("track-result")).toHaveTextContent("PH100006");
    expect(screen.getByTestId("track-status")).toHaveTextContent("Confirmed");
    expect(screen.getByTestId("track-result")).toHaveTextContent("Oct 21, 2026");
  });

  it("walks the status history as a timeline", () => {
    render(
      <OrderDetails result={result()} onTrackAnother={vi.fn()} onVerifyPhone={vi.fn()} onSelectOrder={vi.fn()} />,
    );

    const timeline = screen.getByTestId("track-timeline");
    expect(timeline).toHaveTextContent("Order Received");
    expect(timeline).toHaveTextContent("Confirmed");
  });

  it("lists the items with their options and the line total", () => {
    render(
      <OrderDetails result={result()} onTrackAnother={vi.fn()} onVerifyPhone={vi.fn()} onSelectOrder={vi.fn()} />,
    );

    const items = screen.getByTestId("track-items");
    expect(items).toHaveTextContent("Narrow Gap Cabinet");
    expect(items).toHaveTextContent("Qty 1");
    expect(items).toHaveTextContent("₱2,299.00");
  });

  it("shows the stored option text, falling back to the legacy variant text", () => {
    render(
      <OrderDetails
        result={result({
          items: [
            {
              id: "item-1",
              productId: null,
              variantId: null,
              skuId: "sku-1",
              productNameSnapshot: "Side Table",
              skuCodeSnapshot: "WALNUT",
              variantSnapshot: "Walnut",
              optionSnapshot: null,
              quantity: 1,
              unitPrice: "10",
              lineTotal: "10",
              createdAt: "2026-09-22T00:00:00.000Z",
            },
          ],
        })}
        onTrackAnother={vi.fn()}
        onVerifyPhone={vi.fn()}
        onSelectOrder={vi.fn()}
      />,
    );

    const items = screen.getByTestId("track-items");
    expect(items).toHaveTextContent("Walnut · Qty 1");
  });

  it("shows the totals with the discount and the free shipping", () => {
    render(
      <OrderDetails result={result()} onTrackAnother={vi.fn()} onVerifyPhone={vi.fn()} onSelectOrder={vi.fn()} />,
    );

    const totals = screen.getByTestId("track-totals");
    expect(totals).toHaveTextContent("Subtotal");
    expect(totals).toHaveTextContent("₱2,299.00");
    expect(totals).toHaveTextContent("−₱99.00");
    expect(totals).toHaveTextContent("Free");
    expect(totals).toHaveTextContent("₱2,200.00");
  });

  it("shows the delivery address when the shopper proved the phone", () => {
    render(
      <OrderDetails result={result()} onTrackAnother={vi.fn()} onVerifyPhone={vi.fn()} onSelectOrder={vi.fn()} />,
    );

    const address = screen.getByTestId("track-address");
    expect(address).toHaveTextContent("Juan Dela Cruz");
    expect(address).toHaveTextContent("123 Test Street");
    expect(address).toHaveTextContent("Quezon City");
  });

  it("asks for the mobile number instead of the address when only the order number was given", () => {
    render(
      <OrderDetails
        result={result({
          matchedBy: "orderNumber",
          personalDetailsIncluded: false,
          shippingAddress: null,
          customer: { id: "customer-1", name: null, normalizedPhone: null, email: null },
        })}
        onTrackAnother={vi.fn()}
        onVerifyPhone={vi.fn()}
        onSelectOrder={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("track-address")).toBeNull();
    const verify = screen.getByTestId("track-verify");
    expect(verify).toHaveTextContent(/mobile number/i);
  });

  it("verifies with the mobile number the shopper types", async () => {
    const user = userEvent.setup();
    const onVerifyPhone = vi.fn();
    render(
      <OrderDetails
        result={result({
          matchedBy: "orderNumber",
          personalDetailsIncluded: false,
          shippingAddress: null,
        })}
        onTrackAnother={vi.fn()}
        onVerifyPhone={onVerifyPhone}
        onSelectOrder={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("track-verify-phone"), "09171234567");
    await user.click(screen.getByTestId("track-verify-submit"));

    expect(onVerifyPhone).toHaveBeenCalledWith("09171234567");
  });

  it("lists the other orders on the same number and opens the one picked", async () => {
    const user = userEvent.setup();
    const onSelectOrder = vi.fn();
    render(
      <OrderDetails
        result={result({
          otherOrders: [
            {
              orderNumber: "PH100003",
              createdAt: "2026-09-18T02:40:00.000Z",
              orderStatus: "SIGNED",
              grandTotal: "1200",
            },
          ],
        })}
        onTrackAnother={vi.fn()}
        onVerifyPhone={vi.fn()}
        onSelectOrder={onSelectOrder}
      />,
    );

    const others = screen.getByTestId("track-other-orders");
    expect(others).toHaveTextContent("PH100003");

    await user.click(screen.getByTestId("track-other-PH100003"));

    expect(onSelectOrder).toHaveBeenCalledWith("PH100003");
  });

  it("does not show the address hint when the details are already included", () => {
    render(
      <OrderDetails result={result()} onTrackAnother={vi.fn()} onVerifyPhone={vi.fn()} onSelectOrder={vi.fn()} />,
    );

    expect(screen.queryByTestId("track-verify")).toBeNull();
    expect(screen.queryByTestId("track-other-orders")).toBeNull();
  });
});
