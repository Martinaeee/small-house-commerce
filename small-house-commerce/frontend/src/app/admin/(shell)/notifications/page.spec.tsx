import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminNotificationsResponse } from "@/lib/admin-notifications";
import type { UseAdminNotificationsResult } from "@/components/admin/useAdminNotifications";
import AdminNotificationsPage from "./page";

const hook = vi.hoisted(() => ({
  current: null as UseAdminNotificationsResult | null,
  retry: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/components/admin/useAdminNotifications", () => ({
  useAdminNotifications: () => hook.current,
}));

const populated: AdminNotificationsResponse = {
  totalCount: 21,
  items: [
    {
      kind: "ORDER_NEEDS_REVIEW",
      count: 1,
      href: "/admin/orders?confirmation=NEEDS_REVIEW",
    },
    {
      kind: "ORDER_UNCONFIRMED",
      count: 2,
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
      count: 6,
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

function pageTree() {
  return (
    <AdminI18nProvider>
      <AdminNotificationsPage />
    </AdminI18nProvider>
  );
}

describe("AdminNotificationsPage", () => {
  beforeEach(() => {
    setAdminLang("en");
    hook.retry.mockReset();
    hook.refresh.mockReset();
    setHookState("loading", null);
  });

  it("explains that the workspace reflects current operational state and renders loading", () => {
    render(pageTree());

    expect(
      screen.getByRole("heading", { name: "Notifications", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Counts reflect current business state and may change after refresh.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading notifications",
    );
  });

  it("reuses the shared list for every exact allowlisted deep link", () => {
    setHookState("ready", populated);
    render(pageTree());

    expect(screen.getByText("21 items require attention")).toBeVisible();
    const workspace = screen.getByRole("region", {
      name: "Current notifications",
    });
    expect(
      within(workspace)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/admin/orders?confirmation=NEEDS_REVIEW",
      "/admin/orders?confirmation=UNCONFIRMED",
      "/admin/products?attention=missing_media",
      "/admin/products?attention=no_priced_sku",
      "/admin/products?attention=incomplete_shipping",
      "/admin/products?attention=stale_draft",
    ]);
    expect(workspace).toHaveTextContent("Orders need review");
    expect(workspace).toHaveTextContent("Stale draft products");
    expect(workspace).not.toHaveTextContent(/unread|read|new since|ago/i);
    expect(workspace).not.toHaveTextContent(/low inventory|campaign|schedule/i);
  });

  it("renders the permission-filtered empty response honestly", () => {
    setHookState("empty", { totalCount: 0, items: [] });
    render(pageTree());

    expect(screen.getByRole("status")).toHaveTextContent(
      "There are no notifications requiring attention.",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a retryable error without a second page-only request path", async () => {
    const user = userEvent.setup();
    setHookState("error", null);
    render(pageTree());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Notifications could not be loaded",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(hook.retry).toHaveBeenCalledTimes(1);
    expect(hook.refresh).not.toHaveBeenCalled();
  });

  it("switches page copy and rows through the shared admin language store", () => {
    setHookState("ready", populated);
    render(pageTree());

    act(() => setAdminLang("zh"));
    expect(
      screen.getByRole("heading", { name: "通知中心", level: 1 }),
    ).toBeVisible();
    expect(screen.getByText("当前有 21 项需要处理")).toBeVisible();
    expect(screen.getByText("订单需要复核")).toBeVisible();
  });
});
