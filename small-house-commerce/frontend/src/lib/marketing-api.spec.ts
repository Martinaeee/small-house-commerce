import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, adminAuthedFetch } from "./admin-auth";
import { canManageMarketingPage, marketingApi } from "./marketing-api";
import type { LandingContent } from "./marketing-content";

vi.mock("./admin-auth", async (original) => ({ ...await original<typeof import("./admin-auth")>(), adminAuthedFetch: vi.fn() }));
const content: LandingContent = { schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null, blocks: [{ id: "buy", type: "buy", sourceKey: null, props: {} }] };
beforeEach(() => vi.mocked(adminAuthedFetch).mockReset());

describe("marketing authenticated API", () => {
  it("uploads raw media only through an encoded saved-page endpoint", async () => {
    expect(marketingApi.uploadMedia).toBeTypeOf("function");
    const file = new File(["image"], "chair.jpg", { type: "image/jpeg" });
    await marketingApi.uploadMedia("page/1", file, "image/jpeg");
    expect(vi.mocked(adminAuthedFetch).mock.calls[0]).toEqual(["/api/v1/admin/landing-pages/page%2F1/uploads", expect.objectContaining({ method: "POST", headers: { "Content-Type": "image/jpeg" }, body: file, cache: "no-store", referrerPolicy: "no-referrer" })]);
  });

  it("writes versioned content and internal name without public address or owner changes", async () => {
    await marketingApi.saveDraft("page/1", content, 3, "My campaign");
    const [path, init] = vi.mocked(adminAuthedFetch).mock.calls[0];
    expect(path).toBe("/api/v1/admin/landing-pages/page%2F1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ content, expectedVersion: 3, name: "My campaign" });
  });

  it("uses dedicated product and owner pickers and encodes list filters", async () => {
    await marketingApi.productOptions({ search: "Chair & table", page: 2 });
    expect(vi.mocked(adminAuthedFetch).mock.calls[0][0]).toBe("/api/v1/admin/landing-pages/product-options?search=Chair+%26+table&page=2");
    await marketingApi.ownerOptions();
    expect(vi.mocked(adminAuthedFetch).mock.calls[1][0]).toBe("/api/v1/admin/landing-pages/owner-options");
    await marketingApi.listPages({ ownerUserId: "u1", effectiveStatus: "DRAFT" });
    expect(vi.mocked(adminAuthedFetch).mock.calls[2][0]).toBe("/api/v1/admin/landing-pages?ownerUserId=u1&effectiveStatus=DRAFT");
  });

  it("preserves 409 status for the editor instead of silently retrying a write", async () => {
    vi.mocked(adminAuthedFetch).mockRejectedValueOnce(new AdminApiError("Version conflict", 409));
    await expect(marketingApi.publish("page", 2)).rejects.toMatchObject({ status: 409 });
    expect(adminAuthedFetch).toHaveBeenCalledTimes(1);
  });

  it("assigns an explicitly selected owner only through the dedicated versioned action", async () => {
    expect(marketingApi).toHaveProperty("assignOwner");
    await marketingApi.assignOwner("page/1", "user-2", 3);
    expect(vi.mocked(adminAuthedFetch).mock.calls[0]).toEqual(["/api/v1/admin/landing-pages/page%2F1/assign-owner", expect.objectContaining({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer", body: JSON.stringify({ ownerUserId: "user-2", expectedVersion: 3 }) })]);
    vi.mocked(adminAuthedFetch).mockRejectedValueOnce(new AdminApiError("Conflict", 409));
    await expect(marketingApi.assignOwner("page/1", "user-2", 3)).rejects.toMatchObject({ status: 409 });
    expect(adminAuthedFetch).toHaveBeenCalledTimes(2);
  });

  it("persists links and only renames or disables with a saved version", async () => {
    const input = { productId: "p1", landingPageId: "lp1", variantId: "v1", name: "Ad A", sourceType: "META_AD" as const, utmCampaign: "Chair & table" };
    await marketingApi.createLink(input);
    expect(vi.mocked(adminAuthedFetch).mock.calls[0]).toEqual(["/api/v1/admin/campaign-links", expect.objectContaining({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer", body: JSON.stringify(input) })]);
    await marketingApi.updateLink("link/1", "Rename", 2);
    expect(vi.mocked(adminAuthedFetch).mock.calls[1]).toEqual(["/api/v1/admin/campaign-links/link%2F1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Rename", expectedVersion: 2 }) })]);
    await marketingApi.disableLink("link/1", 3);
    expect(vi.mocked(adminAuthedFetch).mock.calls[2][0]).toBe("/api/v1/admin/campaign-links/link%2F1/disable");
    expect(JSON.parse(String(vi.mocked(adminAuthedFetch).mock.calls[2][1]?.body))).toEqual({ expectedVersion: 3 });
  });

  it("lists owner-scoped links and obtains server-derived target choices", async () => {
    await marketingApi.listLinks({ landingPageId: "page/1", search: "Ad & chair", status: "DISABLED" });
    expect(vi.mocked(adminAuthedFetch).mock.calls[0][0]).toBe("/api/v1/admin/campaign-links?landingPageId=page%2F1&search=Ad+%26+chair&status=DISABLED");
    await marketingApi.linkContext();
    expect(vi.mocked(adminAuthedFetch).mock.calls[1][0]).toBe("/api/v1/admin/link-builder/context");
    await marketingApi.cloneLink("link/1", { name: "Ad copy", adId: "new-ad" });
    expect(vi.mocked(adminAuthedFetch).mock.calls[2][0]).toBe("/api/v1/admin/campaign-links/link%2F1/clone");
    expect(JSON.parse(String(vi.mocked(adminAuthedFetch).mock.calls[2][1]?.body))).toEqual({ name: "Ad copy", adId: "new-ad" });
  });

  it("saves only USD inputs and a real correction version through an uncached cost endpoint", async () => {
    const input = { linkId: "link-1", costDate: "2026-10-11", amountUsd: "50.00", phpPerUsd: "57.3", expectedVersion: 2 };
    await marketingApi.saveCost(input);
    expect(vi.mocked(adminAuthedFetch).mock.calls[0]).toEqual(["/api/v1/admin/marketing/costs", expect.objectContaining({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer", body: JSON.stringify(input) })]);
    await marketingApi.voidCost("cost/1", 3);
    expect(vi.mocked(adminAuthedFetch).mock.calls[1]).toEqual(["/api/v1/admin/marketing/costs/cost%2F1/void", expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedVersion: 3 }) })]);
  });

  it("reads cost filters and audit history without hiding a version conflict", async () => {
    await marketingApi.listCosts({ linkId: "link/1", includeVoided: true, dateFrom: "2026-10-01" });
    expect(vi.mocked(adminAuthedFetch).mock.calls[0][0]).toBe("/api/v1/admin/marketing/costs?linkId=link%2F1&includeVoided=true&dateFrom=2026-10-01");
    await marketingApi.costAudit("cost/1");
    expect(vi.mocked(adminAuthedFetch).mock.calls[1][0]).toBe("/api/v1/admin/marketing/costs/cost%2F1/audit");
    await marketingApi.getLink("link/1");
    expect(vi.mocked(adminAuthedFetch).mock.calls[2][0]).toBe("/api/v1/admin/campaign-links/link%2F1");
    vi.mocked(adminAuthedFetch).mockRejectedValueOnce(new AdminApiError("Conflict", 409));
    await expect(marketingApi.saveCost({ linkId: "l", costDate: "2026-10-11", amountUsd: "0.00", phpPerUsd: null })).rejects.toMatchObject({ status: 409 });
    expect(adminAuthedFetch).toHaveBeenCalledTimes(4);
  });

  it("queries touch-date reports by immutable link IDs with no cache or referrer", async () => {
    await marketingApi.report({ from: "2026-10-05", to: "2026-10-07", groupBy: "PAGE", linkIds: ["link/1", "link-2"], productId: "p1" });
    expect(vi.mocked(adminAuthedFetch).mock.calls[0]).toEqual(["/api/v1/admin/marketing/reports?from=2026-10-05&to=2026-10-07&groupBy=PAGE&linkIds=link%2F1%2Clink-2&productId=p1", expect.objectContaining({ cache: "no-store", referrerPolicy: "no-referrer" })]);
  });

  it("queries page performance with a string compare flag and reads authorized options uncached", async () => {
    expect(marketingApi.performance).toBeTypeOf("function");
    expect(marketingApi.performanceOptions).toBeTypeOf("function");
    await marketingApi.performance({ view: "PRODUCT", productId: "product-1", preset: "LAST_7_DAYS", interval: "DAY", compare: true, sortBy: "name", sortDirection: "asc", page: 1, pageSize: 20 });
    expect(vi.mocked(adminAuthedFetch).mock.calls[0]).toEqual([
      "/api/v1/admin/marketing/performance?view=PRODUCT&productId=product-1&preset=LAST_7_DAYS&interval=DAY&compare=1&sortBy=name&sortDirection=asc&page=1&pageSize=20",
      expect.objectContaining({ cache: "no-store", referrerPolicy: "no-referrer" }),
    ]);
    await marketingApi.performance({ view: "OPTIMIZER", ownerUserId: "user/1", preset: "THIS_WEEK", interval: "WEEK", compare: false, sortBy: "visits", sortDirection: "desc", page: 1, pageSize: 20 });
    expect(vi.mocked(adminAuthedFetch).mock.calls[1][0]).toBe("/api/v1/admin/marketing/performance?view=OPTIMIZER&ownerUserId=user%2F1&preset=THIS_WEEK&interval=WEEK&compare=0&sortBy=visits&sortDirection=desc&page=1&pageSize=20");
    await marketingApi.performanceOptions({ ownerUserId: "user/1" });
    expect(vi.mocked(adminAuthedFetch).mock.calls[2][0]).toBe("/api/v1/admin/marketing/performance/options?ownerUserId=user%2F1");
    await marketingApi.performanceOptions();
    expect(vi.mocked(adminAuthedFetch).mock.calls[3][0]).toBe("/api/v1/admin/marketing/performance/options");
  });

  it("does not treat broad read access as permission to edit another owner", () => {
    const account = { id: "u1", permissions: ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_OWN"] };
    expect(canManageMarketingPage(account, "u2")).toBe(false);
    expect(canManageMarketingPage(account, "u1")).toBe(true);
    expect(canManageMarketingPage({ ...account, permissions: ["MARKETING_MANAGE_ALL"] }, "u2")).toBe(true);
    expect(canManageMarketingPage(null, "u1")).toBe(false);
  });
});
