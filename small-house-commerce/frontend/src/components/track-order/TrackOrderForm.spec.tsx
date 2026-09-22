import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GuestOrderResult } from "@/lib/guestOrder";
import { TrackOrderForm } from "./TrackOrderForm";

/**
 * Guest tracking display contract (plan Task 18): the items list renders the
 * authoritative order-time option snapshot ("Color: Red · Size: Small"), and
 * lines created before the typed option graph fall back to their legacy
 * `variantSnapshot` text — `formatOrderOptions` end-to-end through the real
 * result card.
 */

const lookupOrderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/guestOrder", () => ({ lookupOrder: lookupOrderMock }));

const result: GuestOrderResult = {
  id: "order-1",
  orderNumber: "PH100012",
  customerId: "customer-1",
  orderStatus: "CONFIRMED",
  confirmationStatus: "CONFIRMED",
  paymentStatus: "COD_PENDING",
  currency: "PHP",
  subtotal: "210",
  discountTotal: "0",
  shippingTotal: "0",
  grandTotal: "210",
  optimizerId: null,
  optimizerAidSnapshot: null,
  optimizerNameSnapshot: null,
  customerClassification: null,
  confirmedBy: null,
  confirmedAt: null,
  confirmationNote: null,
  createdAt: "2026-09-22T00:00:00.000Z",
  updatedAt: "2026-09-22T00:00:00.000Z",
  customer: {
    id: "customer-1",
    name: "Juan Dela Cruz",
    normalizedPhone: "+639171234567",
    email: null,
    currentRiskLevel: "NORMAL",
  },
  items: [
    {
      id: "item-1",
      productId: "product-1",
      variantId: "variant-1",
      skuId: "sku-1",
      productNameSnapshot: "Chair",
      skuCodeSnapshot: "RED-SMALL",
      variantSnapshot: "Red / Small",
      optionSnapshot: {
        version: 1,
        options: [
          { optionId: "color", optionValueId: "red", label: "Color", value: "Red" },
          { optionId: "size", optionValueId: "small", label: "Size", value: "Small" },
        ],
      },
      quantity: 2,
      unitPrice: "100",
      unitDiscount: "0",
      unitCostSnapshot: null,
      lineTotal: "200",
      createdAt: "2026-09-22T00:00:00.000Z",
    },
    {
      id: "item-2",
      productId: "product-2",
      variantId: null,
      skuId: "sku-2",
      productNameSnapshot: "Side Table",
      skuCodeSnapshot: "WALNUT",
      variantSnapshot: "Walnut",
      optionSnapshot: null,
      quantity: 1,
      unitPrice: "10",
      unitDiscount: "0",
      unitCostSnapshot: null,
      lineTotal: "10",
      createdAt: "2026-09-22T00:00:00.000Z",
    },
  ],
  shippingAddress: null,
  statusHistory: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  lookupOrderMock.mockResolvedValue(result);
});

describe("TrackOrderForm result card items", () => {
  it("renders the structured snapshot text, falling back to the legacy variant text", async () => {
    const user = userEvent.setup();
    render(<TrackOrderForm />);

    await user.type(screen.getByTestId("track-order-number"), "PH100012");
    await user.type(screen.getByTestId("track-phone"), "0917 123 4567");
    await user.click(screen.getByTestId("track-submit"));

    const items = await screen.findByTestId("track-items");
    await waitFor(() => {
      expect(items).toHaveTextContent("Chair");
      expect(items).toHaveTextContent("Side Table");
    });
    // Structured order-time snapshot is authoritative — not the variant name.
    expect(items).toHaveTextContent("Color: Red · Size: Small · Qty 2");
    expect(items).not.toHaveTextContent("Red / Small");
    // Legacy line (null snapshot) shows its stored variant text.
    expect(items).toHaveTextContent("Walnut · Qty 1");
    // The lookup reached the backend with the entered identity.
    expect(lookupOrderMock).toHaveBeenCalledWith("PH100012", "0917 123 4567");
  });
});
