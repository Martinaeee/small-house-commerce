import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminUser } from "@/lib/admin-auth";
import { AdminGlobalHeader } from "@/components/admin/AdminGlobalHeader";

const ADMIN: AdminUser = {
  id: "admin-1",
  name: "E2E Admin",
  email: "e2e-admin@smallhouse.test",
  status: "ACTIVE",
  roles: [{ code: "SUPER_ADMIN", name: "Super Admin" }],
  permissions: ["PRODUCT_MANAGE", "ORDER_VIEW_ALL"],
};

function renderHeader(
  props: Partial<ComponentProps<typeof AdminGlobalHeader>> = {},
) {
  return render(
    <AdminI18nProvider>
      <AdminGlobalHeader
        moduleTitle="商品"
        admin={ADMIN}
        onLogout={vi.fn()}
        {...props}
      />
    </AdminI18nProvider>,
  );
}

beforeEach(() => {
  setAdminLang("zh");
});

describe("AdminGlobalHeader", () => {
  it("renders an honest Phase-B boundary instead of fake search or notifications", () => {
    renderHeader();

    const search = screen.getByLabelText("全局搜索尚未启用");
    expect(search).toHaveTextContent("全局搜索");
    expect(within(search).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(search).queryByRole("button")).not.toBeInTheDocument();

    const notifications = screen.getByLabelText("通知尚未启用");
    expect(notifications).toBeInTheDocument();
    expect(notifications.tagName).not.toBe("BUTTON");
    expect(screen.getByText("Philippines / PHP")).toBeInTheDocument();
  });

  it("uses real account data, exposes permissions read-only, and keeps logout real", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderHeader({ onLogout });

    const account = screen.getByRole("group", { name: "账户菜单" });
    expect(within(account).getAllByText("E2E Admin").length).toBeGreaterThan(0);
    expect(within(account).getAllByText("SUPER_ADMIN").length).toBeGreaterThan(0);
    expect(within(account).getByText("e2e-admin@smallhouse.test")).toBeInTheDocument();
    expect(within(account).getByText("PRODUCT_MANAGE")).toBeInTheDocument();
    expect(within(account).getByText("ORDER_VIEW_ALL")).toBeInTheDocument();
    expect(within(account).queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(within(account).getByRole("button", { name: "退出登录" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing language control and accepts real Phase-B slots later", async () => {
    const user = userEvent.setup();
    renderHeader({
      searchControl: <button type="button">Search live</button>,
      notificationControl: <button type="button">Notifications live</button>,
    });

    expect(screen.getByRole("button", { name: "Search live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications live" })).toBeInTheDocument();
    expect(screen.queryByLabelText("全局搜索尚未启用")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换语言" }));
    expect(screen.getByRole("button", { name: "Switch language" })).toBeInTheDocument();
    expect(screen.getByText("Philippines / PHP")).toBeInTheDocument();
  });
});
