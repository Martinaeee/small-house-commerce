import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import type { AdminCustomerDetail } from "@/lib/admin-api";
import AdminCustomerPage from "./page";

const pageState = vi.hoisted(() => ({
  canManage: true,
  customerId: "c1",
  getCustomer: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: pageState.customerId }),
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    hasPermission: (permission: string) =>
      pageState.canManage && permission === "CUSTOMER_MANAGE",
  }),
}));

vi.mock("@/lib/admin-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api")>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      getCustomer: (...args: unknown[]) => pageState.getCustomer(...args),
    },
  };
});

function customerFixture(
  overrides: Partial<AdminCustomerDetail> = {},
): AdminCustomerDetail {
  return {
    id: "c1",
    name: "Jane Cruz",
    normalizedPhone: "+639171234567",
    email: "jane@example.com",
    currentRiskLevel: "NORMAL",
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-20T08:00:00.000Z",
    addresses: [
      {
        id: "a1",
        customerId: "c1",
        fullName: "Jane C.",
        phone: "09181234567",
        province: "Metro Manila",
        city: "Quezon City",
        barangay: "Bago Bantay",
        postalCode: "1105",
        streetAddress: "1 Main St",
        landmark: "Near the park",
        createdAt: "2026-09-01T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AdminI18nProvider>
      <AdminCustomerPage />
    </AdminI18nProvider>,
  );
}

describe("AdminCustomerPage", () => {
  beforeEach(() => {
    setAdminLang("en");
    pageState.canManage = true;
    pageState.customerId = "c1";
    pageState.getCustomer.mockReset();
  });

  afterEach(cleanup);

  it("renders only real customer identity, risk, dates, and addresses", async () => {
    pageState.getCustomer.mockResolvedValue(customerFixture());
    renderPage();

    expect(await screen.findByRole("heading", { name: "Jane Cruz" })).toBeVisible();
    expect(pageState.getCustomer).toHaveBeenCalledWith("c1");
    expect(screen.getByText("+639171234567")).toBeVisible();
    expect(screen.getByText("jane@example.com")).toBeVisible();
    expect(screen.getByText("NORMAL")).toBeVisible();
    expect(screen.getByText("1 Main St")).toBeVisible();
    expect(screen.getByText("Bago Bantay, Quezon City, Metro Manila 1105")).toBeVisible();
    expect(screen.getByText("Near the park")).toBeVisible();
    expect(screen.getByText("Sep 1, 2026")).toBeVisible();
    expect(screen.queryByRole("button", { name: /save|保存/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|delete|编辑|删除/i })).not.toBeInTheDocument();
  });

  it.each([
    [403, "You do not have permission to view customer details."],
    [404, "Customer not found."],
    [500, "Could not load customer details."],
  ])("shows the correct non-editable error state for %s", async (status, message) => {
    pageState.getCustomer.mockRejectedValue(new AdminApiError("failed", status));
    renderPage();

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("prevents the request and shows an honest unavailable state without CUSTOMER_MANAGE", async () => {
    pageState.canManage = false;
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "You do not have permission to view customer details.",
    );
    expect(pageState.getCustomer).not.toHaveBeenCalled();
  });

  it("uses the fallback title and empty-address state without inventing data", async () => {
    pageState.getCustomer.mockResolvedValue(
      customerFixture({ name: null, email: null, addresses: [] }),
    );
    renderPage();

    expect(await screen.findByText("No saved addresses")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Customer" })).toBeVisible();
    expect(screen.queryByText("jane@example.com")).not.toBeInTheDocument();
  });

  it("shows a loading skeleton while the customer request is pending", () => {
    pageState.getCustomer.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("status", { name: "Loading" })).toBeVisible();
  });
});
