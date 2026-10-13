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
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/admin/newsletter/SubscribersTable", () => ({
  SubscribersTable: ({ canWrite }: { canWrite: boolean }) => (
    <div data-testid="subscriber-panel">canWrite:{String(canWrite)}</div>
  ),
}));
vi.mock("@/components/admin/newsletter/PromotionPanel", () => ({
  PromotionPanel: () => <div data-testid="promotion-panel" />,
}));

beforeEach(() => {
  authMock.permissions = ["NEWSLETTER_READ"];
});

describe("NewsletterAdminPage permissions", () => {
  it("shows read-only subscribers without promotion management", () => {
    render(<NewsletterAdminPage />);

    expect(screen.getByTestId("subscriber-panel")).toHaveTextContent(
      "canWrite:false",
    );
    expect(
      screen.queryByRole("tab", { name: "newsletter_tab_promotions" }),
    ).toBeNull();
  });

  it("shows the promotion tab only to a system settings editor", async () => {
    authMock.permissions = [
      "NEWSLETTER_READ",
      "NEWSLETTER_WRITE",
      "SYSTEM_SETTINGS_EDIT",
    ];
    render(<NewsletterAdminPage />);

    expect(screen.getByTestId("subscriber-panel")).toHaveTextContent(
      "canWrite:true",
    );
    await userEvent.setup().click(
      screen.getByRole("tab", { name: "newsletter_tab_promotions" }),
    );
    expect(screen.getByTestId("promotion-panel")).toBeInTheDocument();
  });
});
