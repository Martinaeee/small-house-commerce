import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminOrderDetail } from "@/lib/admin-api";
import { CustomerHistoryDialog, OrderHistoryDialog } from "./HistoryPanels";

const api = vi.hoisted(() => ({
  customerOrderHistory: vi.fn(),
  getOrder: vi.fn(),
  orderVerification: vi.fn(),
}));

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  adminApi: api,
}));

const DETAIL = {
  id: "order-1",
  orderNumber: "PH100004",
  orderStatus: "NEW",
  confirmationStatus: "UNCONFIRMED",
  paymentStatus: "COD_PENDING",
  customerClassification: "NEW",
  customerId: "cust-1",
  assignedToId: null,
  createdAt: "2026-10-21T14:22:00.000Z",
  subtotal: "1499",
  discountTotal: "0",
  shippingTotal: "0",
  grandTotal: "1499",
  currency: "PHP",
  customer: { id: "cust-1", name: "Marisol Reyes", normalizedPhone: "+639171224466" },
  items: [
    {
      id: "line-1",
      skuCodeSnapshot: "SKU-FD-140-WN",
      productNameSnapshot: "Foldable Desk",
      quantity: 1,
      lineTotal: "1499",
      unitPrice: "1499",
    },
  ],
  assignedTo: null,
  riskFlags: [],
  shippingAddress: null,
  verification: {
    assigned: false,
    done: 0,
    total: 0,
    pending: 0,
    problem: 0,
    requiredMissing: 0,
    priority: null,
    nextFollowUpAt: null,
    assigneeId: null,
  },
  payments: [],
  statusHistory: [
    {
      id: "sh-1",
      statusDomain: "ORDER_STATUS",
      oldStatus: null,
      newStatus: "NEW",
      source: "SYSTEM",
      operatorId: null,
      operatorName: null,
      comment: null,
      createdAt: "2026-10-21T14:22:00.000Z",
    },
  ],
  reservations: [],
  notes: [
    {
      id: "n-1",
      orderId: "order-1",
      userId: "staff-a",
      noteType: "CUSTOMER_SERVICE",
      content: "客户来电确认购买",
      createdAt: "2026-10-21T15:35:00.000Z",
      operatorName: "客服 A",
    },
  ],
  mergeRecordsPrimary: [],
  mergeRecordsMerged: [],
  shipments: [],
  attribution: null,
} as unknown as AdminOrderDetail;

function renderWithI18n(node: React.ReactNode) {
  return render(<AdminI18nProvider>{node}</AdminI18nProvider>);
}

beforeEach(() => {
  cleanup();
  setAdminLang("en");
  vi.clearAllMocks();
  api.getOrder.mockResolvedValue(DETAIL);
  api.orderVerification.mockResolvedValue({
    assignment: null,
    items: [],
    events: [
      {
        id: "ev-1",
        orderId: "order-1",
        itemId: "it-1",
        type: "RESULT_SET",
        fromStatus: "PENDING",
        toStatus: "DONE",
        result: "客户明确确认购买",
        note: null,
        operatorId: "staff-a",
        createdAt: "2026-10-21T15:36:00.000Z",
      },
    ],
  });
  api.customerOrderHistory.mockResolvedValue({
    phone: "+639171224466",
    customerName: "Marisol Reyes",
    customerClassification: "NEW",
    total: 4,
    signed: 1,
    rate: 25,
    shipping: 1,
    open: 1,
    confirmed: 0,
    cancelled: 1,
    exception: 0,
    value: 5145,
    lastOrderAt: "2026-10-21T16:02:00.000Z",
    orders: [
      {
        id: "order-1",
        orderNumber: "PH100004",
        createdAt: "2026-10-21T14:22:00.000Z",
        orderStatus: "NEW",
        confirmationStatus: "UNCONFIRMED",
        paymentStatus: "COD_PENDING",
        grandTotal: "1499",
        customerClassification: "NEW",
        ownerName: "客服 A",
        items: [
          {
            id: "line-1",
            skuCodeSnapshot: "SKU-FD-140-WN",
            productNameSnapshot: "Foldable Desk",
            quantity: 1,
            unitPrice: "1499",
            lineTotal: "1499",
          },
        ],
        riskFlags: [],
      },
    ],
  });
});

describe("the customer order history", () => {
  it("shows how often this phone signs for its orders", async () => {
    renderWithI18n(
      <CustomerHistoryDialog phone="+639171224466" open onClose={() => {}} />,
    );

    expect(await screen.findByText(/PH100004/)).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("Signature rate")).toBeTruthy();
  });

  it("shows the customer, the goods and the owner of every order", async () => {
    renderWithI18n(
      <CustomerHistoryDialog
        phone="+639171224466"
        currentOrderNumber="PH100004"
        open
        onClose={() => {}}
      />,
    );

    expect((await screen.findAllByText(/PH100004/)).length).toBeGreaterThan(0);
    // the customer and the order the operator came from
    expect(screen.getByText("Marisol Reyes")).toBeTruthy();
    expect(screen.getByText("Current order")).toBeTruthy();
    // the goods and the owner are columns of the list
    expect(screen.getByText("Product / SKU")).toBeTruthy();
    expect(screen.getByText("Foldable Desk")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("客服 A")).toBeTruthy();
    // the money is whole pesos
    expect(screen.getByText("₱1,499")).toBeTruthy();
  });
});

describe("the processing history", () => {
  it("lists what changed, who changed it and why", async () => {
    renderWithI18n(
      <OrderHistoryDialog
        orderId="order-1"
        open
        onClose={() => {}}
        staff={[{ id: "staff-a", name: "客服 A" }]}
      />,
    );

    expect(await screen.findByText(/PH100004/)).toBeTruthy();
    expect(screen.getByText("客户来电确认购买")).toBeTruthy();
    expect(screen.getAllByText("客服 A").length).toBeGreaterThan(0);
    expect(screen.getByText("Verified")).toBeTruthy();
  });

  it("shows the other orders of the same phone in the same window", async () => {
    const onOpenPhoneHistory = vi.fn();
    renderWithI18n(
      <OrderHistoryDialog
        orderId="order-1"
        open
        onClose={() => {}}
        staff={[{ id: "staff-a", name: "客服 A" }]}
        onOpenPhoneHistory={onOpenPhoneHistory}
      />,
    );

    expect(await screen.findByText(/PH100004/)).toBeTruthy();
    // the section with the other orders of this number
    expect(screen.getByText("The orders of this phone number")).toBeTruthy();
    expect(screen.getByText(/Fulfilment/)).toBeTruthy();

    const open = screen.getByRole("button", {
      name: "Open the customer order history",
    });
    await userEvent.setup().click(open);
    expect(onOpenPhoneHistory).toHaveBeenCalledWith("+639171224466");
  });

  it("filters the history by category", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <OrderHistoryDialog
        orderId="order-1"
        open
        onClose={() => {}}
        staff={[{ id: "staff-a", name: "客服 A" }]}
      />,
    );

    await screen.findByText(/PH100004/);
    await user.click(screen.getByRole("button", { name: /^Logistics/ }));

    await waitFor(() => {
      expect(screen.queryByText("客户来电确认购买")).toBeNull();
    });
  });
});
