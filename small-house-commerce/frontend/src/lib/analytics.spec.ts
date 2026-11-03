import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsSessionId,
  detectDeviceType,
  flushAnalytics,
  trackFirstParty,
} from "./analytics";

describe("first-party analytics", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one session id per browser tab and reuses it", () => {
    const first = analyticsSessionId();
    expect(first).toBeTruthy();
    expect(analyticsSessionId()).toBe(first);
    expect(sessionStorage.getItem("sh:fsid")).toBe(first);
  });

  it("ignores events fired on admin and preview paths", () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState({}, "", "/admin/orders");

    trackFirstParty("PAGE_VIEW");
    flushAnalytics();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("batches storefront events into one request", () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState({}, "", "/products/table");

    trackFirstParty("PRODUCT_VIEW", { productId: "product-1" });
    trackFirstParty("ADD_TO_CART", { productId: "product-1" });
    flushAnalytics();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/storefront/events");
    const body = JSON.parse(init.body as string);
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({
      eventName: "PRODUCT_VIEW",
      productId: "product-1",
      pagePath: "/products/table",
    });
    expect(body.events[0].sessionId).toBe(analyticsSessionId());
  });

  it("reports a device class for the session", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", matchMedia);
    expect(detectDeviceType()).toBe("desktop");

    matchMedia.mockImplementation((query: string) => ({
      matches: query.includes("767px"),
    }));
    expect(detectDeviceType()).toBe("mobile");
  });
});

describe("marketing credential attachment", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("attaches the stored marketing credential to every event", () => {
    localStorage.setItem("sh:marketing-touch", JSON.stringify({ credential: "server.credential", expiresAt: "2099-01-01T00:00:00Z" }));
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState({}, "", "/products/table");

    trackFirstParty("PRODUCT_VIEW", { productId: "product-1" });
    flushAnalytics();

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body)) as { events: Array<Record<string, unknown>> };
    expect(body.events[0]).toMatchObject({ marketingCredential: "server.credential", productId: "product-1" });
  });

  it("omits the credential field when no marketing touch is stored", () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState({}, "", "/products/table");

    trackFirstParty("PRODUCT_VIEW", { productId: "product-1" });
    flushAnalytics();

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body)) as { events: Array<Record<string, unknown>> };
    expect(body.events[0]).not.toHaveProperty("marketingCredential");
  });

  it("does not attach an expired stored credential", () => {
    localStorage.setItem("sh:marketing-touch", JSON.stringify({ credential: "expired.credential", expiresAt: "2000-01-01T00:00:00Z" }));
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState({}, "", "/products/table");

    trackFirstParty("PAGE_VIEW");
    flushAnalytics();

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body)) as { events: Array<Record<string, unknown>> };
    expect(body.events[0]).not.toHaveProperty("marketingCredential");
  });
});
