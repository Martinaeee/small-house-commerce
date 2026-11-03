import { render, screen, within } from "@testing-library/react";
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
});
