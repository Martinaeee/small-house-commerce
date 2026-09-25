import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
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
