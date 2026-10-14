import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "./AdminShell";

const shellState = vi.hoisted(() => ({
  pathname: "/admin",
  permissions: ["ORDER_VIEW_OWN"] as string[],
  replace: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => shellState.pathname,
  useRouter: () => ({ replace: shellState.replace }),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    status: "authed",
    admin: {
      id: "admin-customer",
      name: "Customer agent",
      email: "customer-agent@example.com",
      status: "ACTIVE",
      roles: [],
      permissions: shellState.permissions,
    },
    hasPermission: (permission: string) =>
      shellState.permissions.includes(permission),
    logout: shellState.logout,
  }),
}));

vi.mock("@/components/admin/AdminGlobalHeader", () => ({
  AdminGlobalHeader: ({
    searchControl,
    notificationControl,
  }: {
    searchControl?: ReactNode;
    notificationControl?: ReactNode;
  }) => (
    <header>
      {searchControl}
      {notificationControl}
    </header>
  ),
}));

vi.mock("@/components/admin/AdminGlobalSearch", () => ({
  AdminGlobalSearch: () => <button type="button">Search</button>,
}));

vi.mock("@/components/admin/AdminNotifications", () => ({
  AdminNotifications: () => <button type="button">Notifications live</button>,
}));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));

function renderShell(): void {
  render(
    <AdminShell>
      <p>Protected route content</p>
    </AdminShell>,
  );
}

describe("AdminShell hidden permission-backed destinations", () => {
  beforeEach(() => {
    shellState.pathname = "/admin";
    shellState.permissions = ["ORDER_VIEW_OWN"];
    shellState.replace.mockReset();
    shellState.logout.mockReset();
  });

  it("injects one real notification control into the global header", () => {
    renderShell();

    expect(
      screen.getByRole("button", { name: "Notifications live" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Notifications live" }),
    ).toHaveLength(1);
  });

  it.each(["ORDER_CONFIRM", "PRODUCT_MANAGE"])(
    "keeps notifications mounted for a %s-only account",
    (permission) => {
      shellState.pathname = "/admin/notifications";
      shellState.permissions = [permission];

      renderShell();

      expect(screen.getByText("Protected route content")).toBeVisible();
      expect(
        screen.queryByText("No modules available for your account."),
      ).not.toBeInTheDocument();
    },
  );

  it.each(["ORDER_VIEW_OWN", "ORDER_VIEW_ALL"])(
    "keeps the no-modules boundary on notifications for unsupported %s",
    (permission) => {
      shellState.pathname = "/admin/notifications";
      shellState.permissions = [permission];

      renderShell();

      expect(
        screen.getByText("No modules available for your account."),
      ).toBeVisible();
      expect(screen.queryByText("Protected route content")).not.toBeInTheDocument();
    },
  );

  it.each(["/admin/customers/customer-1", "/admin/search"])(
    "keeps %s mounted for a CUSTOMER_MANAGE-only account",
    (pathname) => {
      shellState.pathname = pathname;
      shellState.permissions = ["CUSTOMER_MANAGE"];

      renderShell();

      expect(screen.getByText("Protected route content")).toBeVisible();
      expect(
        screen.queryByText("No modules available for your account."),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps the no-modules boundary for accounts without a supported route", () => {
    renderShell();

    expect(
      screen.getByText("No modules available for your account."),
    ).toBeVisible();
    expect(screen.queryByText("Protected route content")).not.toBeInTheDocument();
  });
});

describe("AdminShell website navigation group", () => {
  beforeEach(() => {
    shellState.pathname = "/admin/homepage";
    shellState.permissions = ["PRODUCT_MANAGE"];
    shellState.replace.mockReset();
    shellState.logout.mockReset();
  });

  function desktopNav(): HTMLElement {
    return screen.getByRole("navigation", { name: "Admin navigation" });
  }

  it("renders the Website group with its three independently filtered entries", () => {
    shellState.permissions = [
      "PRODUCT_MANAGE",
      "STOREFRONT_SHELL_MANAGE",
      "SYSTEM_SETTINGS_EDIT",
    ];
    renderShell();

    const nav = desktopNav();
    expect(within(nav).getByText("nav_group_website")).toBeVisible();
    expect(
      within(nav).getByRole("link", { name: "nav_homepage" }),
    ).toHaveAttribute("href", "/admin/homepage");
    expect(
      within(nav).getByRole("link", { name: "nav_storefront_shell" }),
    ).toHaveAttribute("href", "/admin/storefront-shell");
    expect(
      within(nav).getByRole("link", { name: "nav_settings" }),
    ).toHaveAttribute("href", "/admin/settings");
  });

  it("shows only Header & Footer to an account holding only shell permission", () => {
    shellState.pathname = "/admin/storefront-shell";
    shellState.permissions = ["STOREFRONT_SHELL_MANAGE"];
    renderShell();

    const nav = desktopNav();
    expect(within(nav).getByText("nav_group_website")).toBeVisible();
    expect(
      within(nav).getByRole("link", { name: "nav_storefront_shell" }),
    ).toBeVisible();
    expect(
      within(nav).queryByRole("link", { name: "nav_homepage" }),
    ).toBeNull();
    expect(
      within(nav).queryByRole("link", { name: "nav_settings" }),
    ).toBeNull();
    expect(screen.getByText("Protected route content")).toBeVisible();
  });

  it("does not let PRODUCT_MANAGE inherit Header & Footer access", () => {
    renderShell();

    const nav = desktopNav();
    expect(
      within(nav).getByRole("link", { name: "nav_homepage" }),
    ).toBeVisible();
    expect(
      within(nav).queryByRole("link", { name: "nav_storefront_shell" }),
    ).toBeNull();
    expect(
      within(nav).queryByRole("link", { name: "nav_settings" }),
    ).toBeNull();
  });

  it("hides the Website group when none of its child permissions survive", () => {
    shellState.permissions = ["ORDER_VIEW_ALL"];
    renderShell();

    expect(within(desktopNav()).queryByText("nav_group_website")).toBeNull();
    expect(
      within(desktopNav()).getByRole("link", { name: "nav_orders" }),
    ).toBeVisible();
  });

  it("shows Newsletter only with NEWSLETTER_READ", () => {
    shellState.permissions = ["NEWSLETTER_READ"];
    renderShell();

    expect(
      within(desktopNav()).getByRole("link", { name: "nav_newsletter" }),
    ).toHaveAttribute("href", "/admin/newsletter");
  });

  it("hides Newsletter when NEWSLETTER_READ is absent", () => {
    shellState.permissions = ["ORDER_VIEW_ALL"];
    renderShell();

    expect(
      within(desktopNav()).queryByRole("link", { name: "nav_newsletter" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the existing navigation items and their order", () => {
    shellState.permissions = [
      "ORDER_VIEW_ALL",
      "INVENTORY_VIEW",
      "PRODUCT_MANAGE",
      "STOREFRONT_SHELL_MANAGE",
      "CAMPAIGN_LINK_BUILD",
      "NEWSLETTER_READ",
      "SYSTEM_SETTINGS_EDIT",
    ];
    renderShell();

    const labels = within(desktopNav())
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      "nav_orders",
      "nav_inventory",
      "nav_products",
      "nav_groupings",
      "nav_single_pages",
      "nav_link_builder",
      "nav_homepage",
      "nav_storefront_shell",
      "nav_settings",
      "nav_newsletter",
    ]);
  });
});
