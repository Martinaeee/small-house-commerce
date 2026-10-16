import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "./admin-api";

const transport = vi.hoisted(() => ({ fetch: vi.fn(), text: vi.fn() }));
vi.mock("./admin-auth", () => ({ adminAuthedFetch: transport.fetch, adminAuthedText: transport.text }));

beforeEach(() => {
  vi.resetAllMocks();
  transport.fetch.mockResolvedValue({ version: 4, components: [], availableInventory: 0 });
});

describe("Bundle admin transport", () => {
  it("encodes component search text instead of injecting query parameters", async () => {
    await adminApi.searchBundleSkus("table & black/?");
    expect(transport.fetch).toHaveBeenCalledWith("/api/v1/admin/products/bundle/sku-search?q=table%20%26%20black%2F%3F");
  });

  it("omits an empty search query so the server uses its bounded default", async () => {
    await adminApi.searchBundleSkus("");
    expect(transport.fetch).toHaveBeenCalledWith("/api/v1/admin/products/bundle/sku-search");
  });

  it("encodes both owner identities in the approved definition route", async () => {
    expect(await adminApi.getBundleComponents("product/id", "sku/id")).toEqual({ version: 4, components: [], availableInventory: 0 });
    expect(transport.fetch).toHaveBeenCalledWith("/api/v1/admin/products/product%2Fid/bundles/sku%2Fid");
  });

  it("sends the expected version and ordered concrete bindings without customer charges", async () => {
    await adminApi.setBundleComponents("product", "bundle", { expectedVersion: 4, components: [
      { componentSkuId: "chair", quantity: 2, position: 0 },
      { componentSkuId: "table", quantity: 1, position: 1 },
    ] });
    expect(transport.fetch).toHaveBeenCalledWith("/api/v1/admin/products/product/bundles/bundle", {
      method: "PUT",
      body: '{"expectedVersion":4,"components":[{"componentSkuId":"chair","quantity":2,"position":0},{"componentSkuId":"table","quantity":1,"position":1}]}',
    });
  });
});
