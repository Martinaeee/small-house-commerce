import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type TouchResponse = { credential: string | null; expiresAt: string | null };
type TouchInput = Parameters<(typeof import("./api"))["api"]["marketingTouch"]>[0];
const apiMock = vi.hoisted(() => ({ marketingTouch: vi.fn<(input: TouchInput) => Promise<TouchResponse>>() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
let tracking: typeof import("./tracking");
const touch = (credential: string, expiresAt = "2026-10-18T01:00:00Z"): TouchResponse => ({ credential, expiresAt });

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-11T01:00:00Z"));
  tracking = await import("@/lib/tracking");
  apiMock.marketingTouch.mockResolvedValue(touch("first.credential"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("effective public marketing touches", () => {
  it("stores a server credential from a product cl entry and never forwards raw owner or ad overrides", async () => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=abcdefghijklmnop&aid=FORGED&ad_id=forged" });
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith({ code: "abcdefghijklmnop", path: "/products/chair", visitKey: expect.any(String) });
  });

  it("reuses the same tab-session key for separate page and product touches", async () => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=abcdefghijklmnop" });
    await tracking.recordMarketingTouch({ path: "/lp/chair-ad", search: "", landingPageId: "44444444-4444-4444-a444-444444444444" });
    expect(apiMock.marketingTouch).toHaveBeenCalledTimes(2);
    expect(apiMock.marketingTouch.mock.calls[0][0].visitKey).toBe(apiMock.marketingTouch.mock.calls[1][0].visitKey);
    expect(apiMock.marketingTouch.mock.calls[1][0]).toMatchObject({ landingPageId: "44444444-4444-4444-a444-444444444444", path: "/lp/chair-ad" });
  });

  it("keeps the last valid credential on ordinary pages, invalid links and network failures", async () => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=abcdefghijklmnop" });
    await tracking.recordMarketingTouch({ path: "/", search: "utm_source=other" });
    expect(apiMock.marketingTouch).toHaveBeenCalledTimes(1);
    apiMock.marketingTouch.mockResolvedValueOnce({ credential: null, expiresAt: null });
    await tracking.recordMarketingTouch({ path: "/lp/chair-ad", search: "cl=invalid", landingPageId: "44444444-4444-4444-a444-444444444444" });
    apiMock.marketingTouch.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=unavailable" })).resolves.toBeUndefined();
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
  });

  it("does not let a slow older response replace a newer valid touch", async () => {
    let finishOld!: (response: TouchResponse) => void;
    apiMock.marketingTouch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const older = tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=older" });
    apiMock.marketingTouch.mockResolvedValueOnce(touch("newer.credential", "2026-10-18T01:00:01Z"));
    await tracking.recordMarketingTouch({ path: "/products/table", search: "cl=newer" });
    expect(finishOld).toBeTypeOf("function");
    finishOld(touch("older.credential")); await older;
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "newer.credential" });
  });

  it("never sends an admin or private-preview touch", async () => {
    await tracking.recordMarketingTouch({ path: "/admin/marketing/page/preview", search: "cl=abcdefghijklmnop" });
    expect(apiMock.marketingTouch).not.toHaveBeenCalled();
  });

  it("continues without throwing when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await expect(tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=abcdefghijklmnop" })).resolves.toBeUndefined();
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
  });

  it("sends legacy fields only for an explicit AID, with canonical ad_id taking precedence", async () => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "aid=OP-1&ad_id=canonical&adid=legacy&utm_content=creative" });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith(expect.objectContaining({ aid: "OP-1", adId: "canonical", utmContent: "creative" }));
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
  });
});
