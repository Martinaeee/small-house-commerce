import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import CheckoutDraftsPage from "./page";

const api = vi.hoisted(() => ({
  listCheckoutDrafts: vi.fn(),
  listAssignees: vi.fn(),
  followUpCheckoutDraft: vi.fn(),
}));
let canView = true;
let canVerify = true;

vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    hasPermission: (permission: string) => (permission === "ORDER_VIEW_ALL" ? canView : canVerify),
  }),
}));

describe("CheckoutDraftsPage", () => {
  beforeEach(() => {
    canView = true;
    canVerify = true;
    setAdminLang("zh");
    api.listCheckoutDrafts.mockReset();
    api.listAssignees.mockReset();
    api.followUpCheckoutDraft.mockReset();
    api.listAssignees.mockResolvedValue([{ id: "user-2", name: "客服 B" }]);
    api.followUpCheckoutDraft.mockResolvedValue({});
    api.listCheckoutDrafts.mockResolvedValue({
      items: [
        {
          id: "draft-1",
          status: "OPEN",
          hasUserInput: true,
          contactName: "Ana",
          contactPhone: "0917",
          itemCount: 2,
          firstItemName: "Oak Chair",
          firstItemThumbnail: null,
          orderId: null,
          orderNumber: null,
          createdAt: "2026-11-03T00:00:00.000Z",
          updatedAt: "2026-11-03T00:05:00.000Z",
          expiresAt: "2026-12-03T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it("lists partially filled drafts with their saved contact", async () => {
    render(
      <AdminI18nProvider>
        <CheckoutDraftsPage />
      </AdminI18nProvider>,
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("0917")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("未完成")).toBeInTheDocument();
  });

  it("does not label a failed request as an empty inbox", async () => {
    api.listCheckoutDrafts.mockRejectedValue(new Error("Offline"));
    render(<AdminI18nProvider><CheckoutDraftsPage /></AdminI18nProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿加载失败");
    expect(screen.queryByText("还没有草稿订单。")).not.toBeInTheDocument();
  });

  it("hides the page from operators without ORDER_VIEW_ALL", async () => {
    canView = false;
    render(
      <AdminI18nProvider>
        <CheckoutDraftsPage />
      </AdminI18nProvider>,
    );
    expect(await screen.findByText("没有查看草稿订单的权限。")).toBeInTheDocument();
    expect(api.listCheckoutDrafts).not.toHaveBeenCalled();
  });

  it("shows the follow-up queue and filters by the saved result", async () => {
    api.listCheckoutDrafts.mockResolvedValue({
      items: [{
        id: "draft-1",
        status: "OPEN",
        hasUserInput: true,
        contactName: "Ana",
        contactPhone: "0917",
        itemCount: 2,
        firstItemName: "Oak Chair",
        firstItemThumbnail: null,
        orderId: null,
        orderNumber: null,
        followUpStatus: "NO_ANSWER",
        followUpNote: null,
        assignee: { id: "u2", name: "客服 B" },
        nextFollowUpAt: "2026-11-06T02:00:00.000Z",
        lastContactedAt: null,
        createdAt: "2026-11-03T00:00:00.000Z",
        updatedAt: "2026-11-03T00:05:00.000Z",
        expiresAt: "2026-12-03T00:00:00.000Z",
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(<AdminI18nProvider><CheckoutDraftsPage /></AdminI18nProvider>);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("未接")).toBeInTheDocument();
    expect(within(table).getByText("客服 B")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("跟进结果筛选"), { target: { value: "WANTS_TO_BUY" } });
    await waitFor(() => expect(api.listCheckoutDrafts).toHaveBeenLastCalledWith(
      expect.objectContaining({ followUpStatus: "WANTS_TO_BUY", page: 1 }),
    ));
  });

  it("assigns an owner and the first follow-up straight from the row", async () => {
    render(<AdminI18nProvider><CheckoutDraftsPage /></AdminI18nProvider>);
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: "未分配" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("分配负责人")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("负责人"), { target: { value: "user-2" } });
    fireEvent.change(within(dialog).getByLabelText("跟进结果"), { target: { value: "TO_CONTACT" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存跟进" }));

    await waitFor(() => expect(api.followUpCheckoutDraft).toHaveBeenCalledWith("draft-1", {
      status: "TO_CONTACT",
      assigneeId: "user-2",
      nextFollowUpAt: null,
      note: null,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listCheckoutDrafts).toHaveBeenCalledTimes(2);
  });

  it("only offers the inline assignment on drafts with saved form data", async () => {
    api.listCheckoutDrafts.mockResolvedValue({
      items: [{
        id: "draft-1",
        status: "OPEN",
        hasUserInput: false,
        contactName: null,
        contactPhone: null,
        itemCount: 0,
        firstItemName: null,
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
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(<AdminI18nProvider><CheckoutDraftsPage /></AdminI18nProvider>);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("未分配")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "未分配" })).not.toBeInTheDocument();
  });

  it("does not offer assignment without ORDER_VERIFY or on a converted draft", async () => {
    canVerify = false;
    render(<AdminI18nProvider><CheckoutDraftsPage /></AdminI18nProvider>);
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("未分配")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "未分配" })).not.toBeInTheDocument();
    expect(api.listAssignees).not.toHaveBeenCalled();
  });
});
