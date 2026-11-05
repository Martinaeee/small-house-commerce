import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import CheckoutDraftDetailPage from "./page";

const api = vi.hoisted(() => ({
  getCheckoutDraft: vi.fn(),
  followUpCheckoutDraft: vi.fn(),
  createOrder: vi.fn(),
  listAssignees: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "draft-1" }) }));
vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    hasPermission: (permission: string) => permission === "ORDER_VERIFY" || permission === "ORDER_VIEW_ALL",
  }),
}));

function draft(over: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    status: "OPEN",
    hasUserInput: true,
    contactName: "Ana",
    contactPhone: "0917",
    itemCount: 1,
    firstItemName: "Oak Chair",
    firstItemThumbnail: null,
    orderId: null,
    orderNumber: null,
    followUpStatus: null,
    followUpNote: null,
    assignee: null,
    nextFollowUpAt: null,
    lastContactedAt: null,
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:05:00.000Z",
    expiresAt: "2026-12-03T00:00:00.000Z",
    snapshot: {
      customer: {
        name: "Ana", phone: "0917", province: "Bulacan", city: "Meycauayan",
        barangay: "", postalCode: "", streetAddress: "1 Main St", landmark: "",
      },
      items: [{ skuId: "sku-1", quantity: 2 }],
      preferredDeliveryDate: null,
      promoCodeInput: "",
      promoCodeApplied: null,
      customerNote: "Call first",
    },
    productSnapshot: [{ skuId: "sku-1", skuCode: "SH-1", productName: "Oak Chair", variantName: "Natural", thumbnailUrl: null, unitPrice: "1299", quantity: 2 }],
    followUpEvents: [],
    ...over,
  };
}

beforeEach(() => {
  setAdminLang("zh");
  vi.clearAllMocks();
  api.getCheckoutDraft.mockResolvedValue(draft());
  api.listAssignees.mockResolvedValue([{ id: "user-2", name: "客服 B" }]);
  api.followUpCheckoutDraft.mockResolvedValue({});
  api.createOrder.mockResolvedValue({ id: "order-1", orderNumber: "PH100030" });
});

describe("checkout draft customer-service follow-up", () => {
  it("records the result, owner, next call and note", async () => {
    const user = userEvent.setup();
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    await screen.findByText("客服跟进");

    fireEvent.change(screen.getByLabelText("负责人"), { target: { value: "user-2" } });
    fireEvent.change(screen.getByLabelText("跟进结果"), { target: { value: "NO_ANSWER" } });
    fireEvent.change(screen.getByLabelText("下次跟进"), { target: { value: "2026-11-06T10:00" } });
    fireEvent.change(screen.getByLabelText("跟进备注"), { target: { value: "No answer, call tomorrow" } });
    await user.click(screen.getByRole("button", { name: "保存跟进" }));

    await waitFor(() => expect(api.followUpCheckoutDraft).toHaveBeenCalledWith("draft-1", {
      status: "NO_ANSWER",
      assigneeId: "user-2",
      nextFollowUpAt: new Date("2026-11-06T10:00").toISOString(),
      note: "No answer, call tomorrow",
    }));
    expect(api.getCheckoutDraft).toHaveBeenCalledTimes(2);
  });

  it("fills the note from a common follow-up template", async () => {
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    await screen.findByText("客服跟进");
    expect(screen.getByRole("option", { name: "联系确认是否要购买Oak Chair" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("常用备注"), { target: { value: "CHECK_PURCHASE" } });
    expect(screen.getByLabelText("跟进备注")).toHaveValue("联系确认是否要购买Oak Chair");
    fireEvent.change(screen.getByLabelText("常用备注"), { target: { value: "NO_ANSWER" } });
    expect(screen.getByLabelText("跟进备注")).toHaveValue("电话未接，稍后再联系");
  });

  it("shows the timeline of earlier attempts", async () => {
    api.getCheckoutDraft.mockResolvedValue(draft({
      followUpStatus: "NO_ANSWER",
      followUpNote: "No answer",
      followUpEvents: [{
        id: "e1", fromStatus: null, toStatus: "TO_CONTACT", note: "Assigned",
        operatorName: "客服 A", createdAt: "2026-11-03T02:00:00.000Z",
      }],
    }));
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    expect(await screen.findByText(/客服 A/)).toBeInTheDocument();
    expect(screen.getByText(/Assigned/)).toBeInTheDocument();
  });

  it("only offers the order form after the customer agreed to buy", async () => {
    const user = userEvent.setup();
    api.getCheckoutDraft.mockResolvedValue(draft({ followUpStatus: "WANTS_TO_BUY" }));
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    await screen.findByRole("button", { name: "创建订单" });
    expect(screen.queryByRole("button", { name: "创建订单" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "创建订单" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Oak Chair")).toBeInTheDocument();
    expect(screen.getByLabelText("收件地址")).toHaveValue("1 Main St");
  });

  it("creates the order from the draft and marks it converted", async () => {
    const user = userEvent.setup();
    api.getCheckoutDraft.mockResolvedValue(draft({ followUpStatus: "WANTS_TO_BUY" }));
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    await user.click(await screen.findByRole("button", { name: "创建订单" }));
    await user.click(screen.getByRole("button", { name: "确认创建订单" }));

    await waitFor(() => expect(api.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      checkoutDraftId: "draft-1",
      items: [{ skuId: "sku-1", quantity: 2 }],
      customer: expect.objectContaining({ name: "Ana", phone: "0917", streetAddress: "1 Main St" }),
    })));
    expect(await screen.findByText(/PH100030/)).toBeInTheDocument();
  });

  it("hides the follow-up form once the draft already became an order", async () => {
    api.getCheckoutDraft.mockResolvedValue(draft({ status: "CONVERTED", orderId: "order-1", orderNumber: "PH100020" }));
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    expect(await screen.findByText(/PH100020/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存跟进" })).not.toBeInTheDocument();
  });

  it("does not offer a second conversion on an already converted draft", async () => {
    api.getCheckoutDraft.mockResolvedValue(draft({ status: "CONVERTED", orderId: "order-1", orderNumber: "PH100020", followUpStatus: "WANTS_TO_BUY" }));
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    expect(await screen.findByText(/PH100020/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建订单" })).not.toBeInTheDocument();
  });
});
