import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import CheckoutDraftDetailPage from "./page";

const api = vi.hoisted(() => ({
  getCheckoutDraft: vi.fn(),
  followUpCheckoutDraft: vi.fn(),
  createOrder: vi.fn(),
  checkoutDraftRisk: vi.fn(),
  convertCheckoutDraft: vi.fn(),
  listAssignees: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "draft-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    hasPermission: (permission: string) =>
      permission === "ORDER_VERIFY" || permission === "ORDER_VIEW_ALL" || permission === "ORDER_CONFIRM",
  }),
}));

function draft(over: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    clientRevision: 4,
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
  api.checkoutDraftRisk.mockResolvedValue({
    validPhone: true, requiresReview: false, classification: "NEW", reason: "No prior orders", orders: [],
  });
  api.convertCheckoutDraft.mockResolvedValue({ id: "order-1", orderNumber: "PH100030" });
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

  it("offers the confirmed conversion panel, not the older create-order dialog", async () => {
    api.getCheckoutDraft.mockResolvedValue(draft({ followUpStatus: "WANTS_TO_BUY" }));
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    expect(await screen.findByRole("button", { name: "转订单并确认" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "创建订单" })).not.toBeInTheDocument();
  });

  it("converts the draft through the reviewed conversion endpoint instead of an ordinary checkout", async () => {
    const user = userEvent.setup();
    api.getCheckoutDraft.mockResolvedValue(draft({ followUpStatus: "WANTS_TO_BUY" }));
    render(<AdminI18nProvider><CheckoutDraftDetailPage /></AdminI18nProvider>);
    await user.click(await screen.findByRole("button", { name: "转订单并确认" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "转订单并确认" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(api.convertCheckoutDraft).toHaveBeenCalledWith("draft-1", expect.objectContaining({
      expectedRevision: 4,
      customer: expect.objectContaining({ name: "Ana", phone: "0917", streetAddress: "1 Main St" }),
    })));
    expect(api.createOrder).not.toHaveBeenCalled();
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
