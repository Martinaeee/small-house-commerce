import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { ProductFunnel } from "./ProductFunnel";
import { ProductFunnelDrawer } from "./ProductFunnelDrawer";
import type { FunnelRow } from "@/lib/funnel-api";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock("@/lib/funnel-api", () => ({ funnelApi: api }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    admin: { id: "admin", permissions: ["MARKETING_VIEW_ALL"] },
  }),
}));
vi.mock("@/lib/marketing-api", () => ({
  marketingApi: { ownerOptions: vi.fn(async () => []) },
}));
const row: FunnelRow = {
  productId: "p1",
  productName: "Shoe cabinet",
  productCode: "SH001",
  thumbnailUrl: null,
  visits: 40,
  views: 33,
  addToCarts: 12,
  checkouts: 6,
  attempts: 5,
  failures: 2,
  orders: 3,
  orderingSessions: 3,
  conversion: 0.075,
  steps: [
    {
      key: "CHECKOUT",
      rate: 0.021,
      baselineRate: 0.084,
      flagged: true,
      base: 100,
      hits: 2,
      sampleSmall: false,
    },
  ],
  failureReasons: { STOCK: 2 },
};
const filters = {
  from: "2026-11-01",
  to: "2026-11-06",
  traffic: "ALL" as const,
};
const mount = (ui: React.ReactNode) => (
  <AdminI18nProvider>{ui}</AdminI18nProvider>
);
describe("product funnel", () => {
  it("shows a product, independent order count and explicit anomaly explanation", async () => {
    api.list.mockResolvedValue({
      rows: [row],
      total: 1,
      page: 1,
      pageSize: 50,
      asOf: "2026-11-06T01:00:00Z",
    });
    render(mount(<ProductFunnel />));
    expect(
      await screen.findByRole("button", { name: "Shoe cabinet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "点击表头排序" })).toHaveValue(
      "CONVERSION",
    );
    expect(screen.getByTestId("funnel-failures-p1")).toHaveTextContent("2");
    expect(screen.getByTestId("funnel-flag-p1-CHECKOUT")).toHaveTextContent(
      "!",
    );
    expect(
      screen.getByTestId("funnel-flag-p1-CHECKOUT").getAttribute("title"),
    ).toContain("8.4%");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
  it("hides customer information until explicitly revealed and loads reason filters", async () => {
    api.detail.mockResolvedValue({
      product: row,
      daily: [],
      reasons: [{ label: "STOCK", count: 2 }],
      devices: [],
      sources: [],
      messages: [],
    });
    api.sessions.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          device: "mobile",
          source: "META_AD",
          entryPath: "/lp/table",
          startedAt: "2026-11-06T01:00:00Z",
          lastAt: "2026-11-06T01:01:00Z",
          events: [
            {
              eventName: "CHECKOUT_SUBMIT_FAILED",
              at: "2026-11-06T01:01:00Z",
              pagePath: "/checkout/confirm",
              diagnostic: {
                reason: "STOCK",
                idempotencyKey: "whole-key",
                customer: {
                  name: "Ana",
                  phone: "09171234567",
                  province: "Metro Manila",
                  city: "Quezon City",
                  streetAddress: "Private street",
                },
              },
            },
          ],
        },
      ],
      nextCursor: null,
    });
    render(
      mount(
        <ProductFunnelDrawer row={row} filters={filters} onClose={() => {}} />,
      ),
    );
    fireEvent.click(screen.getByRole("tab", { name: "会话时间线" }));
    fireEvent.click(await screen.findByText("session-1"));
    expect(screen.queryByText("Private street")).not.toBeInTheDocument();
    expect(screen.queryByText("whole-key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示完整信息" }));
    expect(screen.getByText(/Private street/)).toBeInTheDocument();
    expect(screen.getByText("whole-key")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("失败原因"), {
      target: { value: "STOCK" },
    });
    await waitFor(() =>
      expect(api.sessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ reason: "STOCK" }),
      ),
    );
    expect(screen.queryByText("whole-key")).not.toBeInTheDocument();
  });
});
