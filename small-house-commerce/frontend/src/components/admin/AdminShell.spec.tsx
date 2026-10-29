import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "./AdminShell";

const shellState = vi.hoisted(() => ({
  pathname: "/admin",
  permissions: ["ORDER_VIEW_OWN"] as string[],
  replace: vi.fn(),
  logout: vi.fn(),
  setLang: vi.fn(),
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

vi.mock("@/components/admin/AdminGlobalSearch", () => ({
  AdminGlobalSearch: () => <button type="button">Search</button>,
}));

vi.mock("@/components/admin/AdminNotifications", () => ({
  AdminNotifications: () => <button type="button">Notifications live</button>,
}));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key, lang: "en", setLang: shellState.setLang }),
}));

function renderShell(): void {
  render(
    <AdminShell>
      <p>Protected route content</p>
    </AdminShell>,
  );
}

describe("AdminShell Studio isolation", () => {
  beforeEach(() => {
    shellState.pathname = "/admin/homepage";
    shellState.permissions = ["PRODUCT_MANAGE", "ORDER_VIEW_ALL"];
    shellState.replace.mockReset();
    shellState.logout.mockReset();
    shellState.setLang.mockReset();
  });

  it.each([
    ["/admin/homepage", "homepage-studio"],
    ["/admin/homepage/versions", "default"],
    ["/admin/homepage/", "default"],
    ["/admin/homepage-old", "default"],
    ["/admin/products", "default"],
    ["/admin/orders", "default"],
  ])("uses the correct shell mode for %s", (pathname, mode) => {
    shellState.pathname = pathname;
    renderShell();
    expect(document.querySelector(".admin-shell")).toHaveAttribute("data-admin-shell-mode", mode);
    expect(screen.getByRole("link", { name: "nav_products" })).toHaveAttribute("href", "/admin/products");
    expect(screen.getByRole("link", { name: "nav_orders" })).toHaveAttribute("href", "/admin/orders");
    // Every admin route can collapse its rail; Studio starts collapsed, the
    // rest of the back office starts expanded like before.
    const toggle = document.querySelector("aside button[aria-expanded]");
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", mode === "default" ? "true" : "false");
  });

  it("collapses the rail on a non-Studio route and keeps the choice across navigation", () => {
    shellState.pathname = "/admin/products";
    const { rerender } = render(
      <AdminShell>
        <p>Protected route content</p>
      </AdminShell>,
    );
    const toggle = screen.getByRole("button", { name: "admin_nav_collapse" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "admin_nav_expand" })).toHaveAttribute("aria-expanded", "false");
    // The permission-filtered links survive the collapsed icon rail.
    expect(screen.getByRole("link", { name: "nav_products" })).toHaveAttribute("href", "/admin/products");
    expect(screen.queryByRole("link", { name: "nav_settings" })).toBeNull();

    // Navigating between admin pages preserves the operator's rail choice.
    shellState.pathname = "/admin/orders";
    rerender(
      <AdminShell>
        <p>Protected route content</p>
      </AdminShell>,
    );
    expect(screen.getByRole("button", { name: "admin_nav_expand" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "admin_nav_expand" }));
    expect(screen.getByRole("button", { name: "admin_nav_collapse" })).toHaveAttribute("aria-expanded", "true");
  });

  it("expands the real permission-filtered navigation without losing header controls and exits with Escape", async () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "admin_nav_expand" });
    toggle.focus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "admin_nav_collapse" })).toHaveAttribute("aria-expanded", "true");
    const nav = screen.getByRole("navigation", { name: "Admin navigation" });
    expect(within(nav).getByRole("link", { name: "nav_homepage" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: "nav_settings" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Notifications live" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "admin_header_switch_language" }));
    expect(shellState.setLang).toHaveBeenCalledWith("zh");
    fireEvent.keyDown(nav, { key: "Escape" });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const account = screen.getByRole("group", { name: "admin_header_account_menu" });
    fireEvent.click(account.querySelector("summary")!);
    await act(async () => fireEvent.click(within(account).getByRole("button", { name: "admin_header_logout" })));
    expect(shellState.logout).toHaveBeenCalledOnce();
    expect(shellState.replace).toHaveBeenCalledWith("/admin/login");
  });

  it("retains the mobile drawer, Escape and focus return on the Studio route", () => {
    renderShell();
    const open = screen.getByRole("button", { name: "Open admin menu" });
    open.focus();
    fireEvent.click(open);
    const drawer = screen.getByRole("dialog", { name: "Admin menu" });
    expect(within(drawer).getByRole("link", { name: "nav_homepage" })).toHaveAttribute("href", "/admin/homepage");
    expect(within(drawer).getByRole("button", { name: "Close admin menu" })).toHaveFocus();
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Admin menu" })).toBeNull();
    expect(open).toHaveFocus();
  });
});

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

  it.each(["MARKETING_VIEW_OWN", "MARKETING_VIEW_ALL"])("shows one unified marketing entry to %s without granting product or order access", (permission) => {
    shellState.pathname = "/admin/marketing";
    shellState.permissions = [permission];
    renderShell();
    expect(screen.getByRole("link", { name: "marketing_title" })).toHaveAttribute("href", "/admin/marketing");
    expect(screen.getByText("Protected route content")).toBeVisible();
    for (const name of ["nav_link_builder", "nav_single_pages", "nav_products", "nav_orders"]) expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  });

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

  it.each([
    ['PRODUCT_FAQ_SHARED_MANAGE'],
    ['PRODUCT_MANAGE'],
  ])('shows the FAQ nav item for %s', (permission) => {
    shellState.permissions = [permission];
    renderShell();

    expect(
      within(desktopNav()).getByRole('link', { name: 'nav_faq' }),
    ).toHaveAttribute('href', '/admin/faq');
  });

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
      "MARKETING_VIEW_ALL",
      "NEWSLETTER_READ",
      "SYSTEM_SETTINGS_EDIT",
    ];
    renderShell();

    const labels = within(desktopNav())
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(labels).toEqual([
      // The dashboard is the first seat: it opens the operator workbench.
      "nav_dashboard",
      "nav_orders",
      "nav_inventory",
      "nav_products",
      "nav_faq",
      "nav_groupings",
      "nav_homepage",
      "nav_storefront_shell",
      "nav_settings",
      "nav_system_status",
      "nav_team",
      "marketing_title",
      "nav_newsletter",
    ]);
  });

  it("shows Team only with SYSTEM_SETTINGS_EDIT", () => {
    shellState.permissions = ["SYSTEM_SETTINGS_EDIT"];
    renderShell();

    expect(
      within(desktopNav()).getByRole("link", { name: "nav_team" }),
    ).toHaveAttribute("href", "/admin/team");
  });

  it("hides Team from an account without SYSTEM_SETTINGS_EDIT", () => {
    shellState.permissions = ["ORDER_VIEW_ALL"];
    renderShell();

    expect(
      within(desktopNav()).queryByRole("link", { name: "nav_team" }),
    ).not.toBeInTheDocument();
  });

  it("blocks a direct visit to the team route without SYSTEM_SETTINGS_EDIT", () => {
    shellState.pathname = "/admin/team";
    shellState.permissions = ["ORDER_VIEW_ALL"];
    renderShell();

    expect(
      screen.getByText("No modules available for your account."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Protected route content")).toBeNull();
  });

  it("mounts the team route for SYSTEM_SETTINGS_EDIT", () => {
    shellState.pathname = "/admin/team";
    shellState.permissions = ["SYSTEM_SETTINGS_EDIT"];
    renderShell();

    expect(screen.getByText("Protected route content")).toBeVisible();
  });
});
