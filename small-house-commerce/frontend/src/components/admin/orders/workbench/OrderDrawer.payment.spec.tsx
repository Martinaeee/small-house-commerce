import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderDrawer } from "./OrderDrawer";
import type { AdminOrderDetail, AdminOrderListRow } from "@/lib/admin-api";

/**
 * The drawer's payment block: how the order is paid, the gateway trail for
 * an online order, and the operator's on-demand query.
 */

const apiMock = vi.hoisted(() => ({
  handoverSummary: vi.fn(),
  getOrder: vi.fn(),
  queryOrderPayment: vi.fn(),
}));
vi.mock("@/lib/admin-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-api")>(
    "@/lib/admin-api",
  );
  return { ...actual, adminApi: { ...actual.adminApi, ...apiMock } };
});

vi.mock("@/lib/admin-i18n", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-i18n")>(
    "@/lib/admin-i18n",
  );
  return {
    ...actual,
    useAdminI18n: () => ({ t: (key: string) => key, lang: "en" }),
  };
});

vi.mock("../HistoryPanels", () => ({ CustomerHistoryBlock: () => null }));
vi.mock("./useCustomerHistory", () => ({
  useCustomerHistory: () => ({ data: null, loading: false, error: null, reload: vi.fn() }),
}));

function row(overrides: Partial<AdminOrderListRow> = {}): AdminOrderListRow {
  return {
    id: "order-1",
    orderNumber: "PH100030",
    customerId: "cust-1",
    orderStatus: "NEW",
    confirmationStatus: "UNCONFIRMED",
    paymentStatus: "ONLINE_PENDING",
    currency: "PHP",
    subtotal: "199.00",
    discountTotal: "0.00",
    shippingTotal: "0.00",
    grandTotal: "199.00",
    optimizerId: null,
    optimizerAidSnapshot: null,
    optimizerNameSnapshot: null,
    customerClassification: "NEW",
    confirmedBy: null,
    confirmedAt: null,
    confirmationNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preferredDeliveryDate: null,
    customerNote: null,
    handoverCompletedAt: null,
    customer: { id: "cust-1", name: "Jane", normalizedPhone: "639171234567" } as never,
    adid: null,
    adId: null,
    campaignId: null,
    attributionDetail: null,
    items: [],
    assignedTo: null,
    riskFlags: [],
    shippingAddress: null,
    paymentMethod: "SUNRATE",
    paymentChannel: "gcash",
    paymentAttemptStatus: "PENDING",
    verification: { total: 0, done: 0, pending: 0, problem: 0, priority: null, nextFollowUpAt: null, assigneeId: null } as never,
    ...overrides,
  };
}

function detail(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    ...(row() as unknown as AdminOrderDetail),
    items: [],
    shippingAddress: null,
    payments: [],
    sunrateAttempts: [
      {
        id: "attempt-1",
        channel: "gcash",
        env: "production",
        merchantOrderNum: "AT20261120100000001234",
        amount: "199.00",
        currency: "PHP",
        transId: "trans-42",
        cardBrand: "visa",
        cardLast4: "4242",
        status: "PENDING",
        lastQueryAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  } as unknown as AdminOrderDetail;
}

function renderDrawer(orderRow = row(), onChanged = vi.fn()) {
  return render(
    <OrderDrawer
      row={orderRow}
      onClose={vi.fn()}
      staff={[]}
      onOpenVerify={vi.fn()}
      onOpenHistory={vi.fn()}
      onOpenCustomer={vi.fn()}
      onAssign={vi.fn()}
      onConfirm={vi.fn()}
      canConfirm={false}
      confirmBlockedReason={null}
      canHandover={false}
      canShip={false}
      onOpenHandover={vi.fn()}
      onOpenShip={vi.fn()}
      onOpenSign={vi.fn()}
      onChanged={onChanged}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.handoverSummary.mockResolvedValue({
    handedOver: [],
    outstanding: [],
    rejected: 0,
    withdrawn: 0,
    complete: false,
    events: [],
  });
  apiMock.getOrder.mockResolvedValue(detail());
});

describe("OrderDrawer payment block", () => {
  it("shows the online channel and the gateway trail, never a full card number", async () => {
    renderDrawer();

    expect(await screen.findByText("GCash")).toBeInTheDocument();
    expect(screen.getByText(/AT20261120100000001234/)).toBeInTheDocument();
    expect(screen.getByText(/trans-42/)).toBeInTheDocument();
    expect(screen.getByText(/visa ···· 4242/)).toBeInTheDocument();
  });

  it("flags an online payment that has been waiting over 30 minutes", async () => {
    renderDrawer(
      row({ createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }),
    );

    expect(await screen.findByTestId("payment-awaiting-badge")).toBeInTheDocument();
  });

  it("queries the gateway on demand and shows the refreshed state", async () => {
    apiMock.queryOrderPayment.mockResolvedValue({
      orderNumber: "PH100030",
      paymentStatus: "PAID",
      attemptStatus: "SUCCEEDED",
      lastQueryAt: new Date().toISOString(),
    });
    const onChanged = vi.fn();
    renderDrawer(row(), onChanged);

    await userEvent.setup().click(await screen.findByTestId("payment-query"));

    await waitFor(() =>
      expect(apiMock.queryOrderPayment).toHaveBeenCalledWith("PH100030"),
    );
    expect(await screen.findByTestId("payment-query-result")).toHaveTextContent(
      /PAID/,
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the refusal when the gateway query is rejected", async () => {
    apiMock.queryOrderPayment.mockRejectedValue(new Error("PAYMENT_QUERY_FAILED"));
    renderDrawer();

    await userEvent.setup().click(await screen.findByTestId("payment-query"));

    expect(await screen.findByTestId("payment-query-result")).toHaveTextContent(
      "PAYMENT_QUERY_FAILED",
    );
  });

  it("reads a cash order as COD", async () => {
    renderDrawer(row({ paymentStatus: "COD_PENDING", paymentMethod: "COD", paymentChannel: null }));

    expect(await screen.findByText("COD")).toBeInTheDocument();
  });
});
