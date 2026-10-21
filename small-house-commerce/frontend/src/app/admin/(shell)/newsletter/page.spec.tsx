import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewsletterAdminPage from "./page";

const authMock = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    hasPermission: (permission: string) =>
      authMock.permissions.includes(permission),
  }),
}));
const routerMock = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => routerMock.params,
}));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/admin/newsletter/SubscribersTable", () => ({
  SubscribersTable: ({ canWrite }: { canWrite: boolean }) => (
    <div data-testid="subscriber-panel">canWrite:{String(canWrite)}</div>
  ),
}));
vi.mock("@/components/admin/newsletter/BackInStockTable", () => ({
  BackInStockTable: ({ canWrite }: { canWrite: boolean }) => (
    <div data-testid="back-in-stock-panel">canWrite:{String(canWrite)}</div>
  ),
}));
vi.mock("@/components/admin/newsletter/PromotionPanel", () => ({
  PromotionPanel: () => <div data-testid="promotion-panel" />,
}));

beforeEach(() => {
  authMock.permissions = ["NEWSLETTER_READ"];
  routerMock.params = new URLSearchParams();
});

describe("NewsletterAdminPage permissions", () => {
  it("shows read-only subscribers and back-in-stock tabs without promotion management", async () => {
    const user = userEvent.setup();
    render(<NewsletterAdminPage />);

    expect(screen.getByTestId("subscriber-panel")).toHaveTextContent(
      "canWrite:false",
    );
    expect(
      screen.queryByRole("tab", { name: "newsletter_tab_promotions" }),
    ).toBeNull();
    const alertsTab = screen.getByRole("tab", {
      name: "newsletter_tab_back_in_stock",
    });
    await user.click(alertsTab);
    expect(screen.getByTestId("back-in-stock-panel")).toHaveTextContent(
      "canWrite:false",
    );
  });

  it("shows the promotion tab only to a system settings editor", async () => {
    const user = userEvent.setup();
    authMock.permissions = [
      "NEWSLETTER_READ",
      "NEWSLETTER_WRITE",
      "SYSTEM_SETTINGS_EDIT",
    ];
    render(<NewsletterAdminPage />);

    expect(screen.getByTestId("subscriber-panel")).toHaveTextContent(
      "canWrite:true",
    );
    await user.click(
      screen.getByRole("tab", { name: "newsletter_tab_back_in_stock" }),
    );
    expect(screen.getByTestId("back-in-stock-panel")).toHaveTextContent(
      "canWrite:true",
    );
    await user.click(
      screen.getByRole("tab", { name: "newsletter_tab_promotions" }),
    );
    expect(screen.getByTestId("promotion-panel")).toBeInTheDocument();
  });

  it("opens the promotions tab from the dashboard's create-discount deep link", () => {
    authMock.permissions = [
      "NEWSLETTER_READ",
      "NEWSLETTER_WRITE",
      "SYSTEM_SETTINGS_EDIT",
    ];
    routerMock.params = new URLSearchParams("tab=promotions");

    render(<NewsletterAdminPage />);

    expect(screen.getByTestId("promotion-panel")).toBeInTheDocument();
  });

  it("ignores a promotions deep link for an account that may not manage them", () => {
    routerMock.params = new URLSearchParams("tab=promotions");

    render(<NewsletterAdminPage />);

    expect(screen.getByTestId("subscriber-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("promotion-panel")).toBeNull();
  });
});
