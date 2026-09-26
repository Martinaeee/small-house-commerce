import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminNotificationsResponse } from "@/lib/admin-notifications";
import { AdminNotifications } from "./AdminNotifications";
import type { UseAdminNotificationsResult } from "./useAdminNotifications";

const hook = vi.hoisted(() => ({
  current: null as UseAdminNotificationsResult | null,
  retry: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("./useAdminNotifications", () => ({
  useAdminNotifications: () => hook.current,
}));

const populated: AdminNotificationsResponse = {
  totalCount: 128,
  items: [
    {
      kind: "ORDER_NEEDS_REVIEW",
      count: 2,
      href: "/admin/orders?confirmation=NEEDS_REVIEW",
    },
    {
      kind: "ORDER_UNCONFIRMED",
      count: 101,
      href: "/admin/orders?confirmation=UNCONFIRMED",
    },
    {
      kind: "PRODUCT_MISSING_MEDIA",
      count: 3,
      href: "/admin/products?attention=missing_media",
    },
    {
      kind: "PRODUCT_NO_PRICED_SKU",
      count: 4,
      href: "/admin/products?attention=no_priced_sku",
    },
    {
      kind: "PRODUCT_INCOMPLETE_SHIPPING",
      count: 5,
      href: "/admin/products?attention=incomplete_shipping",
    },
    {
      kind: "PRODUCT_STALE_DRAFT",
      count: 13,
      href: "/admin/products?attention=stale_draft",
    },
  ],
};

function setHookState(
  status: UseAdminNotificationsResult["status"],
  response: AdminNotificationsResponse | null,
): void {
  hook.current = {
    status,
    response,
    retry: hook.retry,
    refresh: hook.refresh,
  };
}

function renderNotifications({ canViewAll = true }: { canViewAll?: boolean } = {}) {
  return render(
    <AdminI18nProvider>
      <div>
        <AdminNotifications canViewAll={canViewAll} />
        <button type="button">Outside</button>
      </div>
    </AdminI18nProvider>,
  );
}

describe("AdminNotifications", () => {
  beforeEach(() => {
    setAdminLang("zh");
    hook.retry.mockReset();
    hook.refresh.mockReset();
    setHookState("loading", null);
  });

  it("renders one interactive Bell and refreshes current counts whenever opened", async () => {
    const user = userEvent.setup();
    renderNotifications();

    const trigger = screen.getByRole("button", { name: "通知" });
    expect(screen.getAllByRole("button", { name: "通知" })).toHaveLength(1);
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(hook.refresh).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "通知中心" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载通知");

    await user.click(trigger);
    await user.click(trigger);
    expect(hook.refresh).toHaveBeenCalledTimes(2);
  });

  it("announces the exact count while visually capping only the badge at 99+", async () => {
    const user = userEvent.setup();
    setHookState("ready", populated);
    renderNotifications();

    const trigger = screen.getByRole("button", {
      name: "通知，128 个待处理问题",
    });
    const badge = within(trigger).getByText("99+");
    expect(badge).toHaveAttribute("aria-hidden", "true");

    await user.click(trigger);
    const panel = screen.getByRole("dialog", { name: "通知中心" });
    const links = within(panel).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/admin/orders?confirmation=NEEDS_REVIEW",
      "/admin/orders?confirmation=UNCONFIRMED",
      "/admin/products?attention=missing_media",
      "/admin/products?attention=no_priced_sku",
      "/admin/products?attention=incomplete_shipping",
      "/admin/products?attention=stale_draft",
      "/admin/notifications",
    ]);
    expect(panel).toHaveTextContent("订单需要复核");
    expect(panel).toHaveTextContent("订单等待确认");
    expect(panel).toHaveTextContent("商品缺少媒体");
    expect(panel).toHaveTextContent("商品没有已定价 SKU");
    expect(panel).toHaveTextContent("商品配送信息不完整");
    expect(panel).toHaveTextContent("长期未更新的草稿商品");
    expect(within(panel).getByRole("link", { name: "查看全部通知" })).toHaveAttribute(
      "href",
      "/admin/notifications",
    );

    expect(panel).not.toHaveTextContent(/未读|分钟前|低库存|活动|排期/);
    expect(panel).not.toHaveTextContent(/unread|ago|low inventory|campaign/i);
  });

  it("renders honest empty and retryable error states", async () => {
    const user = userEvent.setup();
    setHookState("empty", { totalCount: 0, items: [] });
    const view = renderNotifications();
    await user.click(screen.getByRole("button", { name: "通知" }));
    expect(screen.getByRole("status")).toHaveTextContent("目前没有需要处理的通知");

    setHookState("error", null);
    view.rerender(
      <AdminI18nProvider>
        <div>
          <AdminNotifications canViewAll />
          <button type="button">Outside</button>
        </div>
      </AdminI18nProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("通知加载失败");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(hook.retry).toHaveBeenCalledTimes(1);
  });

  it("closes on outside pointer or Escape and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    setHookState("ready", populated);
    renderNotifications();
    const trigger = screen.getByRole("button", {
      name: "通知，128 个待处理问题",
    });

    await user.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog", { name: "通知中心" })).not.toBeInTheDocument();

    await user.click(trigger);
    screen.getByRole("link", { name: "查看全部通知" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "通知中心" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("switches the complete Bell and panel copy to English", async () => {
    const user = userEvent.setup();
    setHookState("ready", populated);
    renderNotifications();

    act(() => setAdminLang("en"));
    const trigger = screen.getByRole("button", {
      name: "Notifications, 128 active issues require attention",
    });
    await user.click(trigger);

    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(panel).toHaveTextContent("Orders need review");
    expect(panel).toHaveTextContent("Orders await confirmation");
    expect(within(panel).getByRole("link", { name: "View all notifications" })).toBeVisible();
  });

  it("hides View all when the account cannot open the notifications page", async () => {
    const user = userEvent.setup();
    setHookState("ready", populated);
    renderNotifications({ canViewAll: false });

    await user.click(
      screen.getByRole("button", { name: "通知，128 个待处理问题" }),
    );

    const panel = screen.getByRole("dialog", { name: "通知中心" });
    // The panel itself still works — only the dead-end link is gone.
    expect(within(panel).getByText("订单需要复核")).toBeVisible();
    expect(
      within(panel).queryByRole("link", { name: "查看全部通知" }),
    ).toBeNull();
  });

  it("shows View all pointing at the guarded page when the account qualifies", async () => {
    const user = userEvent.setup();
    setHookState("ready", populated);
    renderNotifications({ canViewAll: true });

    await user.click(
      screen.getByRole("button", { name: "通知，128 个待处理问题" }),
    );

    expect(
      within(screen.getByRole("dialog", { name: "通知中心" })).getByRole(
        "link",
        { name: "查看全部通知" },
      ),
    ).toHaveAttribute("href", "/admin/notifications");
  });

  it("counts active issues rather than unique entities", async () => {
    const user = userEvent.setup();
    setHookState("ready", populated);
    renderNotifications();

    await user.click(
      screen.getByRole("button", { name: "通知，128 个待处理问题" }),
    );

    const panel = screen.getByRole("dialog", { name: "通知中心" });
    expect(panel).toHaveTextContent("2 个待处理问题");
    expect(panel).not.toHaveTextContent("2 项");
  });
});
