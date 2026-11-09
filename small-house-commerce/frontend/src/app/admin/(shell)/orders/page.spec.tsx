import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminOrderListRow } from "@/lib/admin-api";
import AdminOrdersPage from "./page";

const api = vi.hoisted(() => ({
  bulkOrders: vi.fn(),
  listOrders: vi.fn(),
  orderCounts: vi.fn(),
  listAssignees: vi.fn(),
  orderOptimizers: vi.fn(),
  listSkus: vi.fn(),
  skuSearch: vi.fn(),
  assignOrder: vi.fn(),
  confirmOrder: vi.fn(),
  cancelOrder: vi.fn(),
  createOrder: vi.fn(),
  orderVerification: vi.fn(),
  setVerificationResult: vi.fn(),
  verificationTemplates: vi.fn(),
  assignVerification: vi.fn(),
  recordVerificationContact: vi.fn(),
  customerOrderHistory: vi.fn(),
  getOrder: vi.fn(),
}));

const navigation = vi.hoisted(() => ({ query: "" }));
const perms = vi.hoisted(() => ({ denied: new Set<string>() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/orders",
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    hasPermission: (permission: string) => !perms.denied.has(permission),
    admin: { id: "staff-a", name: "客服 A", email: "a@b.c", status: "ACTIVE", roles: [], permissions: [] },
  }),
}));

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  adminApi: api,
}));

function row(over: Partial<AdminOrderListRow> = {}): AdminOrderListRow {
  return {
    id: "order-1",
    orderNumber: "PH100004",
    orderStatus: "NEW",
    confirmationStatus: "UNCONFIRMED",
    paymentStatus: "COD_PENDING",
    customerClassification: "NEW",
    adid: "FB-OP-1-261105-01",
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
        productNameSnapshot: "Foldable Desk with Wood-Grain Top",
        variantSnapshot: "Wood grain",
        quantity: 1,
        lineTotal: "1499",
        unitPrice: "1499",
      },
    ],
    assignedTo: null,
    riskFlags: [],
    shippingAddress: {
      fullName: "Marisol Reyes",
      streetAddress: "24-B Kamuning St.",
      barangay: "Kamuning",
      city: "Quezon City",
      province: "Metro Manila",
      postalCode: "1103",
      landmark: null,
    },
    paymentMethod: "COD",
    verification: {
      assigned: true,
      done: 1,
      total: 8,
      pending: 6,
      problem: 1,
      requiredMissing: 5,
      priority: "HIGH",
      nextFollowUpAt: null,
      assigneeId: "staff-a",
    },
    ...over,
  } as unknown as AdminOrderListRow;
}

function renderPage() {
  return render(
    <AdminI18nProvider>
      <AdminOrdersPage />
    </AdminI18nProvider>,
  );
}

beforeEach(() => {
  cleanup();
  window.localStorage.removeItem("luwag_orders_columns_v1");
  window.localStorage.removeItem("luwag_orders_views_v1");
  setAdminLang("en");
  navigation.query = "";
  perms.denied.clear();
  vi.clearAllMocks();
  api.listOrders.mockResolvedValue({ items: [row()], total: 1, page: 1, pageSize: 20 });
  api.orderCounts.mockResolvedValue({
    total: 1,
    byStatus: { NEW: 1 },
    needsReview: 0,
    duplicate: 0,
    todo: 1,
    recheck: 0,
    tohandover: 0,
    toship: 0,
    shipping: 0,
    exception: 0,
    signed: 0,
    codPending: 0,
    cancelled: 0,
    mine: 1,
    queues: {
      all: 1,
      todo: 1,
      recheck: 0,
      tohandover: 0,
      toship: 0,
      shipping: 0,
      exception: 0,
      signed: 0,
      cods: 0,
      cancelled: 0,
      mine: 1,
    },
  });
  api.listAssignees.mockResolvedValue([{ id: "staff-a", name: "客服 A" }]);
  api.orderOptimizers.mockResolvedValue([{ id: "opt-a", aid: "OP-1", name: "投手 A" }]);
  api.skuSearch.mockResolvedValue({ total: 0, items: [] });
  api.customerOrderHistory.mockResolvedValue({
    phone: "+639171224466",
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
    orders: [],
  });
  api.orderVerification.mockResolvedValue({ assignment: null, items: [], events: [] });
});

describe("current-page bulk selection", () => {
  it("selects only visible rows and clears selection after changing page", async () => {
    api.listOrders.mockResolvedValue({ items: [row(), row({ id: "order-2", orderNumber: "PH100005" })], total: 25, page: 1, pageSize: 20 });
    const view = renderPage();
    await screen.findByText("PH100004");
    await userEvent.click(screen.getByLabelText("Select all orders on this page"));
    expect(screen.getByText("2 selected (this page)")).toBeInTheDocument();
    expect(api.bulkOrders).not.toHaveBeenCalled();
    navigation.query = "page=2";
    view.rerender(<AdminI18nProvider><AdminOrdersPage /></AdminI18nProvider>);
    await waitFor(() => expect(screen.queryByText("2 selected (this page)")).not.toBeInTheDocument());
  });

  it("keeps a partial selection marked and clears it when filters change", async () => {
    api.listOrders.mockResolvedValue({ items: [row(), row({ id: "order-2", orderNumber: "PH100005" })], total: 2, page: 1, pageSize: 20 });
    const view = renderPage();
    await screen.findByText("PH100004");
    await userEvent.click(screen.getByLabelText("Select order PH100004"));
    expect(screen.getByLabelText("Select all orders on this page")).toBePartiallyChecked();
    navigation.query = "phone=0917";
    view.rerender(<AdminI18nProvider><AdminOrdersPage /></AdminI18nProvider>);
    await waitFor(() => expect(screen.queryByText("1 selected (this page)")).not.toBeInTheDocument());
  });
});

describe("the order workbench list", () => {
  it("marks an operator-converted draft and displays the draft start in the list time cell", async () => {
    api.listOrders.mockResolvedValue({ items: [row({ draftStartedAt: "2026-10-20T11:00:00Z", draftConvertedManually: true })], total: 1, page: 1, pageSize: 20 });
    renderPage();
    expect(await screen.findByText("Converted from draft")).toBeInTheDocument();
    const time = document.querySelector('time[datetime="2026-10-20T11:00:00Z"]');
    expect(time).not.toBeNull();
  });
  it("does not mark a draft the shopper finished by checking out themselves", async () => {
    api.listOrders.mockResolvedValue({ items: [row({ draftStartedAt: "2026-10-20T11:00:00Z" })], total: 1, page: 1, pageSize: 20 });
    renderPage();
    await screen.findByText("PH100004");
    expect(screen.queryByText("Converted from draft")).not.toBeInTheDocument();
    const time = document.querySelector('time[datetime="2026-10-20T11:00:00Z"]');
    expect(time).not.toBeNull();
  });
  it("shows the wide ERP table with the real fields", async () => {
    renderPage();

    expect(await screen.findByText("PH100004")).toBeTruthy();
    // the verification progress sits under the status
    expect(screen.getByText(/1\/8/)).toBeTruthy();
    // the real unit price, not a computed total - whole pesos, as the draft
    expect(screen.getAllByText("₱1,499").length).toBeGreaterThan(0);
    // the order time is the short form, with how long it has been waiting
    expect(screen.getByText(/^\d{2}-\d{2} \d{2}:\d{2}$/)).toBeTruthy();
    expect(screen.getByText(/⏱ \d+(天 \d+小时|小时 \d+分)/)).toBeTruthy();
    // the address and the region are two columns
    expect(screen.getByText("24-B Kamuning St., Kamuning, Quezon City, Metro Manila")).toBeTruthy();
    expect(screen.getByText("Quezon City")).toBeTruthy();
    // the columns of the workbench, in reading order
    for (const header of [
      "Order no.",
      "Customer",
      "Phone",
      "Status",
      "Product",
      "SKU",
      "Qty",
      "Sold price",
      "Order total",
      "Placed at",
      "Note",
      "Address",
      "Region",
      "History",
      "Actions",
    ]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(`^${header}`) })).toBeTruthy();
    }
  });

  it("shows each order's own recipient name instead of the customer's latest profile name", async () => {
    const base = row();
    api.listOrders.mockResolvedValue({
      items: [
        row({
          id: "order-1",
          orderNumber: "PH100035",
          customer: { ...base.customer, name: "zy s", normalizedPhone: "+639081656543" },
          shippingAddress: { ...base.shippingAddress!, fullName: "test1" },
        }),
        row({
          id: "order-2",
          orderNumber: "PH100036",
          customer: { ...base.customer, name: "zy s", normalizedPhone: "+639081656543" },
          shippingAddress: { ...base.shippingAddress!, fullName: "test2" },
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    renderPage();

    expect(await screen.findByText("test1")).toBeTruthy();
    expect(screen.getByText("test2")).toBeTruthy();
    expect(screen.queryByText("zy s")).toBeNull();
  });

  it("shows the advertising number of the order", async () => {
    renderPage();

    expect(await screen.findByText("FB-OP-1-261105-01")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Ad ID/ })).toBeTruthy();
  });

  it.each(["FB-OP-1-261105-01", null])("shows the advertising number in the actual workbench drawer: %s", async (adid) => {
    api.listOrders.mockResolvedValue({ items: [row({ adid })], total: 1, page: 1, pageSize: 20 });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "PH100004" }));
    const dialog = await screen.findByRole("dialog", { name: "PH100004" });
    const label = within(dialog).getByText("Ad ID");
    expect(label.nextElementSibling).toHaveTextContent(adid ?? "—");
  });

  it("keeps the shipping cost column hidden until the operator asks for it", async () => {
    renderPage();

    await screen.findByText("PH100004");
    expect(screen.queryByRole("columnheader", { name: /^Shipping \(cost\)/ })).toBeNull();
  });

  it("shows the product photo returned with the order line", async () => {
    const line = row().items[0]!;
    api.listOrders.mockResolvedValue({
      items: [
        row({
          items: [{ ...line, thumbnailUrl: "https://cdn.example/desk.jpg" }],
        }),
      ] as AdminOrderListRow[],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPage();

    await screen.findByText("PH100004");
    expect(document.querySelector('img[src="https://cdn.example/desk.jpg"]')).not.toBeNull();
  });

  it("keeps the placeholder when the line has no photo", async () => {
    renderPage();

    await screen.findByText("PH100004");
    expect(document.querySelector("img")).toBeNull();
  });

  it("shows the queue tabs with their counters", async () => {
    renderPage();

    expect(await screen.findByRole("tab", { name: /All orders/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Review/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /To ship/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /My todos/ })).toBeTruthy();
  });

  it("opens the customer history from the phone number", async () => {
    const user = userEvent.setup();
    renderPage();

    const phone = await screen.findByRole("button", { name: "+639171224466" });
    await user.click(phone);

    await waitFor(() => {
      expect(api.customerOrderHistory).toHaveBeenCalledWith("+639171224466");
    });
    expect(await screen.findByText(/Customer order history/)).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("opens the verification drawer from the row", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Continue verifying" }));

    await waitFor(() => {
      expect(api.orderVerification).toHaveBeenCalledWith("order-1");
    });
  });

  it("opens the order drawer with its five tabs", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "PH100004" }));

    expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Verification" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Customer" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Items" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "History" })).toBeTruthy();
  });
});

describe("dashboard and notification deep links", () => {
  it("filters by the payment status named in the URL", async () => {
    navigation.query = "paymentStatus=FAILED";
    renderPage();

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    expect(api.listOrders.mock.calls[0][0]).toMatchObject({ paymentStatus: "FAILED" });
  });

  it("shows the applied payment status as a checked control", async () => {
    const user = userEvent.setup();
    navigation.query = "paymentStatus=FAILED";
    renderPage();

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "More filters" }));
    const box = screen.getByRole("checkbox", { name: "FAILED" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it("picks the optimizer from the AIDs in the orders", async () => {
    const user = userEvent.setup();
    navigation.query = "aid=OP-1";
    renderPage();

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    expect(api.listOrders.mock.calls[0][0]).toMatchObject({ aid: "OP-1" });
    await user.click(screen.getByRole("button", { name: "More filters" }));
    const select = await screen.findByLabelText("Optimizer AID");
    expect((select as HTMLSelectElement).value).toBe("OP-1");
    expect(
      screen.getByRole("option", { name: "投手 A · OP-1" }),
    ).toBeTruthy();
  });

  it("keeps the free-text AID box when no optimizer has an order yet", async () => {
    api.orderOptimizers.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "More filters" }));
    const input = screen.getByLabelText("Optimizer AID") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("placeholder")).toBe("OP-…");
  });

  it("sends no payment status when the parameter is absent", async () => {
    renderPage();

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    expect(api.listOrders.mock.calls[0][0].paymentStatus).toBeUndefined();
  });

  it("shows the multi-status set the dashboard links with", async () => {
    navigation.query = "status=NEW,PENDING,QUESTION";
    renderPage();

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    const select = screen.getByLabelText("Order Status") as HTMLSelectElement;
    expect(select.value).toBe("NEW,PENDING,QUESTION");
    expect(select.selectedOptions[0]?.textContent).toContain("NEW");
  });

  it("filters by the confirmation link of the notifications", async () => {
    navigation.query = "confirmation=NEEDS_REVIEW";
    renderPage();

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    expect(api.listOrders.mock.calls[0][0]).toMatchObject({ confirmation: "NEEDS_REVIEW" });
  });
});

describe("the new-order dialog", () => {
  const skuItem = (over: Record<string, unknown> = {}) => ({
    skuId: "sku-1",
    label: "Kids Study Chair — Black (CH001-B)",
    price: "3499",
    skuCode: "CH001-B",
    thumbnailUrl: "/uploads/black.png",
    ...over,
  });

  it("offers the whole sellable catalogue, not a truncated list", async () => {
    api.skuSearch.mockResolvedValue({
      total: 56,
      items: [
        skuItem(),
        skuItem({
          skuId: "sku-2",
          label: "Clothes Rack — Walnut (GR001-W)",
          price: "3799",
          skuCode: "GR001-W",
          thumbnailUrl: null,
        }),
      ],
    });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /New order/ }));

    // the operator sees how many products are on sale
    expect(await screen.findByText("56 sellable products")).toBeTruthy();
    // every row shows the photo of the variant next to its name
    expect(
      document.querySelector('img[src="/uploads/black.png"]'),
    ).toBeTruthy();
    expect(screen.getByText("Kids Study Chair — Black (CH001-B)")).toBeTruthy();
    expect(screen.getByText("Clothes Rack — Walnut (GR001-W)")).toBeTruthy();
  });

  it("keeps the photo of the picked product on screen", async () => {
    api.skuSearch.mockResolvedValue({ total: 56, items: [skuItem()] });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /New order/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Kids Study Chair/ }));

    expect(
      document.querySelector('img[src="/uploads/black.png"]'),
    ).toBeTruthy();
    expect(screen.getByText("3499")).toBeTruthy();
  });
});

describe("the checkout draft entry", () => {
  it("links the order team to the drafts page", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: /Checkout drafts/ });
    expect(link.getAttribute("href")).toBe("/admin/orders/drafts");
  });

  it("stays hidden without ORDER_VIEW_ALL and keeps the new-order button", async () => {
    perms.denied.add("ORDER_VIEW_ALL");
    renderPage();
    expect(screen.queryByRole("link", { name: /Checkout drafts/ })).toBeNull();
    expect(
      await screen.findByRole("button", { name: /New order/ }),
    ).toBeTruthy();
  });
});
