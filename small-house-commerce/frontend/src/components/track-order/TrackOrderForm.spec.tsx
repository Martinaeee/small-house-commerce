import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackOrderForm } from "./TrackOrderForm";
import type { GuestOrderResult } from "@/lib/guestOrder";

/**
 * The lookup takes ONE field: the order number or the mobile number, never
 * both. A successful lookup replaces the form with the order details.
 */

const lookupOrderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/guestOrder", () => ({ lookupOrder: lookupOrderMock }));

function orderView(
  overrides: Partial<GuestOrderResult["orders"][number]> = {},
): GuestOrderResult["orders"][number] {
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
  it("sends an order number when the value looks like one", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-query"), "PH100006");
    await user.click(screen.getByTestId("track-submit"));

    await waitFor(() =>
      expect(lookupOrderMock).toHaveBeenCalledWith({ orderNumber: "PH100006" }),
    );
  });

  it("sends a mobile number when the value looks like one", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-query"), "0917 123 4567");
    await user.click(screen.getByTestId("track-submit"));

    await waitFor(() =>
      expect(lookupOrderMock).toHaveBeenCalledWith({ phone: "0917 123 4567" }),
    );
  });

  it("refuses to search when the field is empty", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.click(screen.getByTestId("track-submit"));

    expect(lookupOrderMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /enter your order number or your mobile number/i,
    );
  });

  it("rejects a value that is neither an order number nor a phone", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-query"), "abc");
    await user.click(screen.getByTestId("track-submit"));

    expect(lookupOrderMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("has a single field, not one per identifier", () => {
    render(<TrackOrderForm />);

    expect(screen.getByTestId("track-query")).toBeInTheDocument();
    expect(screen.queryByTestId("track-order-number")).toBeNull();
    expect(screen.queryByTestId("track-phone")).toBeNull();
  });
});

describe("TrackOrderForm after a lookup", () => {
  it("shows the order instead of the form", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-query"), "09171234567");
    await user.click(screen.getByTestId("track-submit"));

    expect(await screen.findByTestId("track-result")).toBeInTheDocument();
    expect(screen.queryByTestId("track-submit")).toBeNull();
    expect(screen.queryByTestId("track-query")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Track Your Order" }),
    ).toBeNull();
  });

  it("brings the form back for another order", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-query"), "09171234567");
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

    await user.type(screen.getByTestId("track-query"), "09171234567");
    await user.click(screen.getByTestId("track-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Order not found.",
    );
    expect(screen.getByTestId("track-submit")).toBeInTheDocument();
  });
});

describe("TrackOrderForm support entry", () => {
  it("offers the customer support channel on the lookup page", () => {
    render(<TrackOrderForm />);

    expect(screen.getByTestId("track-support-link")).toHaveTextContent(
      "Contact customer support",
    );
    expect(
      screen.getByText(/order information stays private/i),
    ).toBeInTheDocument();
  });
});

describe("TrackOrderForm prefill", () => {
  it("prefills the order number from the link", () => {
    sessionStorage.setItem("lastOrderPhone", "09171234567");
    render(<TrackOrderForm prefillOrder="PH100006" />);

    expect(screen.getByTestId("track-query")).toHaveValue("PH100006");
  });

  it("prefills the phone from this tab when there is no order number", async () => {
    sessionStorage.setItem("lastOrderPhone", "09171234567");
    render(<TrackOrderForm />);

    await waitFor(() =>
      expect(screen.getByTestId("track-query")).toHaveValue("09171234567"),
    );
  });
});
