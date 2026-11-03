import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "./admin-api";

const authMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  text: vi.fn(),
}));

vi.mock("./admin-auth", () => ({
  adminAuthedFetch: authMock.fetch,
  adminAuthedText: authMock.text,
}));

beforeEach(() => {
  vi.clearAllMocks();
  authMock.fetch.mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });
});

describe("adminApi.confirmOrder", () => {
  it("sends an explicit CONFIRM decision instead of an empty JSON body", async () => {
    await adminApi.confirmOrder("order-1");

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/orders/order-1/confirm",
      { method: "POST", body: JSON.stringify({ decision: "CONFIRM" }) },
    );
  });
});

describe("adminApi.listOrders", () => {
  it("sends the payment status the dashboard's failed-payment card links with", async () => {
    await adminApi.listOrders({ paymentStatus: "FAILED", page: 1 });

    expect(authMock.fetch.mock.calls[0][0]).toBe(
      "/api/v1/admin/orders?paymentStatus=FAILED&page=1",
    );
  });

  it("keeps the period and the status set on the same request", async () => {
    await adminApi.listOrders({
      paymentStatus: "FAILED",
      status: "NEW,PENDING",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });

    const url = authMock.fetch.mock.calls[0][0] as string;
    expect(url).toContain("paymentStatus=FAILED");
    expect(url).toContain("status=NEW%2CPENDING");
    expect(url).toContain("dateFrom=2026-09-01");
    expect(url).toContain("dateTo=2026-09-30");
  });

  it("omits the filter when it was not asked for", async () => {
    await adminApi.listOrders({});

    expect(authMock.fetch.mock.calls[0][0]).toBe("/api/v1/admin/orders");
  });
});
