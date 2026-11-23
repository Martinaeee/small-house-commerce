import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type TouchResponse = { credential: string | null; expiresAt: string | null; paid?: boolean };
type TouchInput = Parameters<(typeof import("./api"))["api"]["marketingTouch"]>[0];
const apiMock = vi.hoisted(() => ({ marketingTouch: vi.fn<(input: TouchInput) => Promise<TouchResponse>>() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
let tracking: typeof import("./tracking");
const touch = (credential: string, expiresAt = "2026-10-18T01:00:00Z", paid?: boolean): TouchResponse => ({ credential, expiresAt, ...(paid === undefined ? {} : { paid }) });

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-11T01:00:00Z"));
  tracking = await import("@/lib/tracking");
  apiMock.marketingTouch.mockResolvedValue(touch("first.credential"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("effective public marketing touches", () => {
  it("forwards the aid for conflict detection and never forwards raw owner overrides", async () => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=abcdefghijklmnop&aid=FORGED&ad_id=forged" });
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith({ code: "abcdefghijklmnop", aid: "FORGED", path: "/products/chair", visitKey: expect.any(String) });
  });

  it.each(["adid", "ad_id"])("forwards a numeric %s alongside a registered link", async (key) => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: `cl=abcdefghijklmnop&${key}=120212345678901234&aid=FORGED&utm_source=forged` });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith(expect.objectContaining({ code: "abcdefghijklmnop", adId: "120212345678901234", aid: "FORGED", utmSource: "forged" }));
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
  });

  it.each(["", "{{ad.id}}", "forged", "12345", "123456789012345678901", "120200000000001,"])("uses valid adid when canonical ad_id is invalid: %j", async (canonical) => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: `cl=abcdefghijklmnop&ad_id=${encodeURIComponent(canonical)}&adid=120212345678901234` });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith(expect.objectContaining({ code: "abcdefghijklmnop", adId: "120212345678901234" }));
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
  });

  it("prefers adid over the legacy ad_id when both numeric aliases are present", async () => {
    await tracking.recordMarketingTouch({ path: "/lp/chair-ad", search: "cl=abcdefghijklmnop&ad_id=120200000000001&adid=120200000000002", landingPageId: "44444444-4444-4444-a444-444444444444" });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith(expect.objectContaining({ code: "abcdefghijklmnop", adId: "120200000000002" }));
  });

  it.each(["", "{{ad.id}}", "forged", "12345", "123456789012345678901", "120212345678901234,", "1e15"])("ignores invalid cl ad IDs without dropping the visit: %j", async (adId) => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: `cl=abcdefghijklmnop&adid=${encodeURIComponent(adId)}` });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith({ code: "abcdefghijklmnop", path: "/products/chair", visitKey: expect.any(String) });
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
  });

  it("does not manufacture a marketing touch from an ad ID alone", async () => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "adid=120212345678901234" });
    expect(apiMock.marketingTouch).not.toHaveBeenCalled();
    expect(tracking.readAttribution()).toEqual({});
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

  it("keeps an organic touch when no paid touch exists", async () => {
    apiMock.marketingTouch.mockResolvedValueOnce(touch("organic.credential", "2026-10-18T01:00:00Z", false));
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=abcdefghijklmnop" });
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "organic.credential" });
  });

  it("lets a paid touch replace an organic one but never the reverse", async () => {
    apiMock.marketingTouch.mockResolvedValueOnce(touch("organic.credential", "2026-10-18T01:00:00Z", false));
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=abcdefghijklmnop" });
    apiMock.marketingTouch.mockResolvedValueOnce(touch("paid.credential", "2026-10-18T02:00:00Z", true));
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "cl=paid" });
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "paid.credential" });
    apiMock.marketingTouch.mockResolvedValueOnce(touch("later.organic", "2026-10-18T03:00:00Z", false));
    await tracking.recordMarketingTouch({ path: "/lp/chair-ad", search: "", landingPageId: "44444444-4444-4444-a444-444444444444" });
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "paid.credential" });
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

  it("sends an explicit AID with adid priority and the paid fields", async () => {
    await tracking.recordMarketingTouch({ path: "/products/chair", search: "aid=OP-1&ad_id=120200000000001&adid=120200000000002&utm_content=creative&ad_set_id=120200000000003" });
    expect(apiMock.marketingTouch).toHaveBeenCalledWith(expect.objectContaining({ aid: "OP-1", adId: "120200000000002", adsetId: "120200000000003", utmContent: "creative" }));
    expect(tracking.readAttribution()).toEqual({ marketingCredential: "first.credential" });
  });
});
