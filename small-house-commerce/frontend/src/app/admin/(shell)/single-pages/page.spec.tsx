import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import SinglePagesPage from "./page";

const mocks = vi.hoisted(() => ({
  copyText: vi.fn(),
  hasPermission: vi.fn(),
  listLandingPages: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: mocks.hasPermission }),
}));
vi.mock("@/lib/admin-api", () => ({
  adminApi: { listLandingPages: mocks.listLandingPages },
}));
vi.mock("@/lib/clipboard", () => ({ copyText: mocks.copyText }));

beforeEach(() => {
  setAdminLang("zh");
  mocks.copyText.mockReset();
  mocks.copyText.mockResolvedValue(false);
  mocks.hasPermission.mockReset();
  mocks.hasPermission.mockReturnValue(true);
  mocks.listLandingPages.mockReset();
  mocks.listLandingPages.mockResolvedValue({
    items: [
      {
        id: "00000000-0000-7000-8000-000000000001",
        name: "Facebook red chair",
        adCode: "FB-RED-1",
        slug: "red-chair-sale",
        productId: "00000000-0000-7000-8000-000000000002",
        productName: "Compact Chair",
        titleOverride: "Compact Chair Sale",
        status: "ACTIVE",
        effectiveStatus: "LIVE",
        startAt: null,
        endAt: null,
        sortOrder: 0,
        updatedAt: "2026-09-27T00:00:00.000Z",
        views: 12,
        orders: 2,
        conversionRate: 1 / 6,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
});

describe("SinglePagesPage copy links", () => {
  it("shows a manual-copy message when copying a landing-page link fails", async () => {
    const user = userEvent.setup();
    render(
      <AdminI18nProvider>
        <SinglePagesPage />
      </AdminI18nProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "复制" }));

    expect(mocks.copyText).toHaveBeenCalledWith(
      `${window.location.origin}/lp/red-chair-sale`,
    );
    expect(screen.getByText("复制失败，请手动选择并复制")).toBeVisible();
  });
});
