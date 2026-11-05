import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import CheckoutDraftsPage from "./page";

const listCheckoutDrafts = vi.fn();
let canView = true;

vi.mock("@/lib/admin-api", () => ({
  adminApi: { listCheckoutDrafts: (...args: unknown[]) => listCheckoutDrafts(...args) },
}));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => canView }),
}));

describe("CheckoutDraftsPage", () => {
  beforeEach(() => {
    canView = true;
    setAdminLang("zh");
    listCheckoutDrafts.mockReset();
    listCheckoutDrafts.mockResolvedValue({
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
    listCheckoutDrafts.mockRejectedValue(new Error("Offline"));
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
    expect(listCheckoutDrafts).not.toHaveBeenCalled();
  });

  it("shows the follow-up queue and filters by the saved result", async () => {
    listCheckoutDrafts.mockResolvedValue({
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
    fireEvent.change(screen.getByLabelText("跟进结果"), { target: { value: "WANTS_TO_BUY" } });
    await waitFor(() => expect(listCheckoutDrafts).toHaveBeenLastCalledWith(
      expect.objectContaining({ followUpStatus: "WANTS_TO_BUY", page: 1 }),
    ));
  });
});
