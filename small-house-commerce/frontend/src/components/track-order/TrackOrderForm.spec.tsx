import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackOrderForm } from "./TrackOrderForm";
import type { GuestOrderResult } from "@/lib/guestOrder";

/**
 * The lookup now takes EITHER the order number OR the mobile number, and a
 * successful lookup replaces the form with the order details.
 */

const lookupOrderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/guestOrder", () => ({ lookupOrder: lookupOrderMock }));

function orderView(overrides: Partial<GuestOrderResult["orders"][number]> = {}): GuestOrderResult["orders"][number] {
  return {
    id: "order-1",
    orderNumber: "PH100006",
    orderStatus: "NEW",
    confirmationStatus: "UNCONFIRMED",
    paymentStatus: "COD_PENDING",
    currency: "PHP",
    subtotal: "210",
    discountTotal: "0",
    shippingTotal: "0",
    grandTotal: "210",
    createdAt: "2026-09-22T00:00:00.000Z",
    customer: {
      id: "customer-1",
      name: "Juan Dela Cruz",
      normalizedPhone: "+639171234567",
      email: null,
    },
    items: [],
    shippingAddress: null,
    statusHistory: [],
    ...overrides,
  };
}

function result(overrides: Partial<GuestOrderResult> = {}): GuestOrderResult {
  return {
    matchedBy: "phone",
    personalDetailsIncluded: true,
    orders: [orderView()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lookupOrderMock.mockResolvedValue(result());
  sessionStorage.clear();
});

describe("TrackOrderForm lookup conditions", () => {
  it("looks the order up with the order number alone", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-order-number"), "PH100006");
    await user.click(screen.getByTestId("track-submit"));

    await waitFor(() =>
      expect(lookupOrderMock).toHaveBeenCalledWith({
        orderNumber: "PH100006",
        phone: undefined,
      }),
    );
  });

  it("looks the order up with the mobile number alone", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-phone"), "0917 123 4567");
    await user.click(screen.getByTestId("track-submit"));

    await waitFor(() =>
      expect(lookupOrderMock).toHaveBeenCalledWith({
        orderNumber: undefined,
        phone: "0917 123 4567",
      }),
    );
  });

  it("refuses to search when neither field is filled", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.click(screen.getByTestId("track-submit"));

    expect(lookupOrderMock).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(/enter your order number or your mobile number/i);
  });

  it("still rejects a malformed order number", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-order-number"), "100006");
    await user.click(screen.getByTestId("track-submit"));

    expect(lookupOrderMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/PH followed by digits/i)).toBeInTheDocument();
  });

  it("sends both fields when the shopper filled both in", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-order-number"), "PH100006");
    await user.type(screen.getByTestId("track-phone"), "09171234567");
    await user.click(screen.getByTestId("track-submit"));

    await waitFor(() =>
      expect(lookupOrderMock).toHaveBeenCalledWith({
        orderNumber: "PH100006",
        phone: "09171234567",
      }),
    );
  });
});

describe("TrackOrderForm after a lookup", () => {
  it("shows the order details instead of the form", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-phone"), "09171234567");
    await user.click(screen.getByTestId("track-submit"));

    expect(await screen.findByTestId("track-result")).toBeInTheDocument();
    expect(screen.queryByTestId("track-submit")).toBeNull();
    expect(screen.queryByTestId("track-order-number")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Track Your Order" })).toBeNull();
  });

  it("brings the form back for another order", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-phone"), "09171234567");
    await user.click(screen.getByTestId("track-submit"));
    await screen.findByTestId("track-result");

    await user.click(screen.getByTestId("track-another"));

    expect(screen.getByTestId("track-submit")).toBeInTheDocument();
    expect(screen.queryByTestId("track-result")).toBeNull();
  });

  it("shows the form again when the lookup fails", async () => {
    const user = userEvent.setup();
    lookupOrderMock.mockRejectedValue(new Error("Order not found."));
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-phone"), "09171234567");
    await user.click(screen.getByTestId("track-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Order not found.");
    expect(screen.getByTestId("track-submit")).toBeInTheDocument();
  });
});

describe("TrackOrderForm prefill", () => {
  it("prefills the order number from the link and the phone from this tab", async () => {
    sessionStorage.setItem("lastOrderPhone", "09171234567");
    render(<TrackOrderForm prefillOrder="PH100006" />);

    expect(screen.getByTestId("track-order-number")).toHaveValue("PH100006");
    // The phone comes from sessionStorage after mount, so wait for it.
    await waitFor(() =>
      expect(screen.getByTestId("track-phone")).toHaveValue("09171234567"),
    );
  });
});
