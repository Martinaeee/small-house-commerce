import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderList } from "./OrderList";
import type { GuestOrderResult, GuestOrderView } from "@/lib/guestOrder";

/**
 * The order list a shopper sees after a lookup. Cards read top to bottom:
 * order number → delivery address → placed date → items → total → order
 * status history. Cards and the status history fold up.
 */

function order(overrides: Partial<GuestOrderView> = {}): GuestOrderView {
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
      normalizedPhone: "+639667443461",
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
        variantSnapshot: "Standard",
        optionSnapshot: null,
        quantity: 1,
        unitPrice: "2299",
        lineTotal: "2299",
        thumbnailUrl: "/uploads/catalog/2026/cabinet.png",
        productSlug: "narrow-gap-cabinet",
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
      streetAddress: "12 Mabini St",
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
    ...overrides,
  };
}

function result(overrides: Partial<GuestOrderResult> = {}): GuestOrderResult {
  return {
    matchedBy: "phone",
    personalDetailsIncluded: true,
    orders: [order()],
    ...overrides,
  };
}

function renderList(r: GuestOrderResult) {
  return render(
    <OrderList
      result={r}
      onTrackAnother={vi.fn()}
      onVerifyPhone={vi.fn()}
    />,
  );
}

describe("OrderList card layout", () => {
  it("shows the order number, the latest status and the total in the header", () => {
    renderList(result());

    expect(screen.getByTestId("track-order-PH100006")).toHaveTextContent(
      "PH100006",
    );
    expect(screen.getByTestId("track-status-PH100006")).toHaveTextContent(
      "Confirmed",
    );
    expect(screen.getByTestId("track-order-PH100006")).toHaveTextContent(
      "₱2,200.00",
    );
  });

  it("reads address, date, items and totals in that order", () => {
    renderList(result());

    const card = screen.getByTestId("track-order-PH100006");
    const addressEl = screen.getByTestId("track-address-PH100006");
    const placedEl = screen.getByTestId("track-placed-PH100006");
    const itemsEl = screen.getByTestId("track-items-PH100006");
    const totalsEl = screen.getByTestId("track-totals-PH100006");
    const after = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    // The address sits above the placed date, which sits above the items.
    expect(after(addressEl, placedEl)).toBe(true);
    expect(after(placedEl, itemsEl)).toBe(true);
    expect(after(itemsEl, totalsEl)).toBe(true);
    expect(card).toHaveTextContent("12 Mabini St");
    expect(addressEl).toHaveTextContent("Quezon City");
    expect(screen.getByTestId("track-items-PH100006")).toHaveTextContent(
      "Qty 1",
    );
    expect(screen.getByTestId("track-totals-PH100006")).toHaveTextContent(
      "−₱99.00",
    );
    expect(screen.getByTestId("track-totals-PH100006")).toHaveTextContent(
      "Free",
    );
  });

  it("links the line to its product page", () => {
    renderList(result());

    const link = screen.getByTestId("track-item-link-item-1");
    expect(link).toHaveAttribute("href", "/products/narrow-gap-cabinet");
    // The name stays on one line - the rest is folded away.
    expect(link.querySelector("span")).toHaveClass("truncate");
  });

  it("puts the photo and the name on the same link to the product page", () => {
    renderList(result());

    const link = screen.getByTestId("track-item-link-item-1");
    // Tapping the product - photo or name - opens that product.
    expect(within(link).getByTestId("track-item-image-item-1")).toBeInTheDocument();
    expect(link).toHaveTextContent("Narrow Gap Cabinet");
  });

  it("leaves a line whose product left the catalog without a link", () => {
    renderList(
      result({
        orders: [
          order({
            items: [
              {
                ...order().items[0]!,
                id: "item-off",
                productSlug: null,
                thumbnailUrl: null,
              },
            ],
          }),
        ],
      }),
    );

    // No dead link: the product has no page to go to.
    expect(screen.queryByTestId("track-item-link-item-off")).toBeNull();
    expect(screen.getByText(/Narrow Gap Cabinet/)).toBeInTheDocument();
  });

  it("shows the product photo for every line", () => {
    renderList(result());

    expect(screen.getByTestId("track-item-image-item-1")).toHaveAttribute(
      "src",
      "/uploads/catalog/2026/cabinet.png",
    );
  });

  it("starts with the status history folded: the latest status, no timeline", () => {
    renderList(result());

    expect(screen.getByTestId("track-history-PH100006")).toHaveTextContent(
      "Confirmed",
    );
    expect(screen.queryByTestId("track-timeline-PH100006")).toBeNull();
  });

  it("expands the history to show every step", async () => {
    const user = userEvent.setup();
    renderList(result());

    await user.click(screen.getByTestId("track-history-PH100006"));

    const timeline = screen.getByTestId("track-timeline-PH100006");
    expect(timeline).toHaveTextContent("Order Received");
    expect(timeline).toHaveTextContent("Confirmed");
  });
});

describe("OrderList folding", () => {
  it("keeps the first order open and the rest folded", () => {
    renderList(
      result({
        orders: [
          order({ id: "o3", orderNumber: "PH100007", orderStatus: "SHIPPING" }),
          order({ id: "o2", orderNumber: "PH100004", orderStatus: "SIGNED" }),
          order({ id: "o1", orderNumber: "PH100003", orderStatus: "SIGNED" }),
        ],
      }),
    );

    // The first card is expanded (items visible)…
    expect(screen.getByTestId("track-items-PH100007")).toBeInTheDocument();
    // …the others are folded (only their header rows remain).
    expect(screen.queryByTestId("track-items-PH100004")).toBeNull();
    expect(screen.queryByTestId("track-items-PH100003")).toBeNull();
    expect(screen.getByTestId("track-toggle-PH100004")).toHaveTextContent(
      "Confirmed",
    );
  });

  it("folds and reopens a card from its header", async () => {
    const user = userEvent.setup();
    renderList(result());

    await user.click(screen.getByTestId("track-toggle-PH100006"));
    expect(screen.queryByTestId("track-items-PH100006")).toBeNull();

    await user.click(screen.getByTestId("track-toggle-PH100006"));
    expect(screen.getByTestId("track-items-PH100006")).toBeInTheDocument();
  });
});

describe("OrderList with withheld details", () => {
  it("asks for the mobile number instead of the address", () => {
    renderList(
      result({
        matchedBy: "orderNumber",
        personalDetailsIncluded: false,
        orders: [
          order({
            customer: {
              id: "customer-1",
              name: null,
              normalizedPhone: null,
              email: null,
            },
            shippingAddress: null,
          }),
        ],
      }),
    );

    expect(screen.queryByTestId("track-address-PH100006")).toBeNull();
    expect(screen.getByTestId("track-verify")).toHaveTextContent(
      /mobile number/i,
    );
  });

  it("verifies with the mobile number the shopper types", async () => {
    const user = userEvent.setup();
    const onVerifyPhone = vi.fn();
    render(
      <OrderList
        result={result({
          matchedBy: "orderNumber",
          personalDetailsIncluded: false,
          orders: [order({ shippingAddress: null })],
        })}
        onTrackAnother={vi.fn()}
        onVerifyPhone={onVerifyPhone}
      />,
    );

    await user.type(screen.getByTestId("track-verify-phone"), "09667443461");
    await user.click(screen.getByTestId("track-verify-submit"));

    expect(onVerifyPhone).toHaveBeenCalledWith("09667443461");
  });
});

describe("carrier tracking", () => {
  it("shows the carrier, the tracking number and each status", () => {
    renderList(
      result({
        orders: [
          order({
            orderStatus: "SHIPPING",
            shipment: {
              carrier: "SHIPDOC",
              trackingNumber: "TRACK123",
              shippedAt: "2026-10-28T02:00:00.000Z",
              signedAt: null,
              tracking: [
                { status: "SHIPPED", at: "2026-10-28T02:00:00.000Z" },
                { status: "IN_TRANSIT", at: "2026-10-29T02:00:00.000Z" },
              ],
            },
          }),
        ],
      }),
    );

    expect(screen.getByText("SHIPDOC · TRACK123")).toBeInTheDocument();
    expect(screen.getByText("In transit")).toBeInTheDocument();
  });

  it("shows no tracking block before the parcel exists", () => {
    renderList(result({ orders: [order({ shipment: null })] }));
    expect(screen.queryByText("Tracking")).not.toBeInTheDocument();
  });

  it("shows the carrier wording and rider phone under the node", () => {
    renderList(
      result({
        orders: [
          order({
            orderStatus: "SHIPPING",
            shipment: {
              carrier: "J&T Express",
              trackingNumber: "JT0000008101561",
              shippedAt: "2026-10-28T02:00:00.000Z",
              signedAt: null,
              tracking: [
                {
                  status: "OUT_FOR_DELIVERY",
                  at: "2026-10-29T02:00:00.000Z",
                  description: "Your package Out for Delivery - prepare exact amount",
                  riderPhone: "9684746842",
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(
      screen.getByText("Your package Out for Delivery - prepare exact amount"),
    ).toBeInTheDocument();
    const call = screen.getByRole("link", { name: "9684746842" });
    expect(call).toHaveAttribute("href", "tel:9684746842");
  });

  it("renders a node with no carrier wording without an empty line", () => {
    renderList(
      result({
        orders: [
          order({
            orderStatus: "SHIPPING",
            shipment: {
              carrier: "J&T Express",
              trackingNumber: "JT1",
              shippedAt: "2026-10-28T02:00:00.000Z",
              signedAt: null,
              tracking: [
                {
                  status: "IN_TRANSIT",
                  at: "2026-10-29T02:00:00.000Z",
                  description: null,
                  riderPhone: null,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(screen.getByText("In transit")).toBeInTheDocument();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });
});
