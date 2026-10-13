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
  authMock.fetch.mockResolvedValue({
    page: 2,
    pageSize: 20,
    total: 1,
    items: [],
  });
});

describe("adminApi back-in-stock alerts", () => {
  it("builds the paged status-filtered list request", async () => {
    await adminApi.listBackInStockSubscriptions({
      page: 2,
      pageSize: 20,
      status: "PENDING",
    });

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/newsletter/back-in-stock?page=2&pageSize=20&status=PENDING",
    );
  });

  it("posts an encoded subscription id to resend", async () => {
    await adminApi.resendBackInStockSubscription("alert/id");

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/newsletter/back-in-stock/alert%2Fid/resend",
      { method: "POST" },
    );
  });
});
