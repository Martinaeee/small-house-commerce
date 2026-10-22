import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminOrdersPage from "./page";

const api = vi.hoisted(() => ({
  listOrders: vi.fn(),
  listAssignees: vi.fn(),
  orderCounts: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ query: "" }));

vi.mock("@/lib/admin-api", () => ({
  adminApi: api,
  formatAmount: (value: string) => value,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/orders",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    status: "authed",
    admin: { id: "admin-1", name: "Admin", permissions: [] },
    hasPermission: () => true,
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  navigation.query = "";
  api.listOrders.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
  api.listAssignees.mockResolvedValue([]);
  api.orderCounts.mockResolvedValue({
    total: 0,
    byStatus: {},
    needsReview: 0,
    duplicate: 0,
  });
});

describe("admin orders page filters", () => {
  it("filters the list by the payment status named in the URL", async () => {
    navigation.query = "paymentStatus=FAILED";

    render(<AdminOrdersPage />);

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    expect(api.listOrders.mock.calls[0][0]).toMatchObject({ paymentStatus: "FAILED" });
  });

  it("shows the payment filter as an active control instead of hiding it", async () => {
    navigation.query = "paymentStatus=FAILED";

    render(<AdminOrdersPage />);

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    const select = screen.getByLabelText("Payment") as HTMLSelectElement;
    expect(select.value).toBe("FAILED");
  });

  it("sends no payment filter when the parameter is absent", async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    expect(api.listOrders.mock.calls[0][0].paymentStatus).toBeUndefined();
  });
});
