import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAttribution } from "./tracking";

const KEY = "sh:marketing-touch";

describe("server credential checkout contract", () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, "", "/"); });

  it("does not derive checkout ownership from raw URL or legacy landing-page storage", () => {
    window.localStorage.setItem("sh:lp", "00000000-0000-7000-8000-000000000003");
    window.history.replaceState({}, "", "/products/chair?aid=forged&ad_id=forged-ad&utm_source=forged");
    expect(readAttribution()).toEqual({});
  });

  it("reads the retained server credential after navigating to an ordinary page", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ credential: "server.credential", expiresAt: "2099-01-01T00:00:00Z" }));
    window.history.replaceState({}, "", "/checkout/confirm");
    expect(readAttribution()).toEqual({ marketingCredential: "server.credential" });
  });

  it("ignores malformed or expired stored credentials", () => {
    for (const value of ["not-json", JSON.stringify({ credential: 123, expiresAt: "2099-01-01T00:00:00Z" }), JSON.stringify({ credential: "expired.credential", expiresAt: "2000-01-01T00:00:00Z" })]) {
      window.localStorage.setItem(KEY, value);
      expect(readAttribution()).toEqual({});
    }
  });
});

describe("Meta pixel bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "1143788914761743");
    // Ads consent is required before the pixel may load or send anything.
    window.localStorage.setItem("luwag:cookie-consent:v1", "granted");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    delete w.fbq;
    delete w._fbq;
    document.head.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("installs the Meta-compatible command stub the loader expects", async () => {
    const { initMetaPixel } = await import("./tracking");
    initMetaPixel();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    expect(typeof w.fbq).toBe("function");
    // Meta's snippet aliases _fbq to the fbq function itself; an array breaks
    // fbevents.js while it replays the queue.
    expect(w._fbq).toBe(w.fbq);
    expect(w.fbq.loaded).toBe(true);
    expect(w.fbq.version).toBe("2.0");
    expect(Array.isArray(w.fbq.queue)).toBe(true);
    expect(w.fbq.queue).toEqual([
      ["init", "1143788914761743"],
      ["track", "PageView"],
    ]);
    expect(document.querySelector('script[src*="fbevents.js"]')).not.toBeNull();
  });

  it("queues an event fired before the layout mounted the pixel", async () => {
    // React runs child effects first, so a product page can emit ViewContent
    // before the layout's pixel bootstrap runs. It must not be dropped.
    const { track } = await import("./tracking");
    track("ViewContent", { content_ids: ["sku-1"] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    expect(w.fbq.queue).toContainEqual([
      "track",
      "ViewContent",
      { content_ids: ["sku-1"] },
    ]);
  });

  it("is idempotent so a second mount does not duplicate the pixel", async () => {
    const { initMetaPixel } = await import("./tracking");
    initMetaPixel();
    initMetaPixel();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    expect(w.fbq.queue).toHaveLength(2);
    expect(document.querySelectorAll('script[src*="fbevents.js"]')).toHaveLength(1);
  });

  it("passes the shared event id to the pixel so CAPI can dedupe it", async () => {
    const { track } = await import("./tracking");
    track("Purchase", { order_id: "LW-1" }, { eventID: "purchase-LW-1" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    expect(w.fbq.queue).toContainEqual([
      "track",
      "Purchase",
      { order_id: "LW-1" },
      { eventID: "purchase-LW-1" },
    ]);
  });
});

describe("Meta pixel consent gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "1143788914761743");
    window.localStorage.removeItem("luwag:cookie-consent:v1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    delete w.fbq;
    delete w._fbq;
    document.head.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads nothing before the visitor has made a choice", async () => {
    const { initMetaPixel } = await import("./tracking");
    initMetaPixel();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).fbq).toBeUndefined();
    expect(document.querySelector('script[src*="fbevents.js"]')).toBeNull();
  });

  it("sends nothing when ads consent is denied", async () => {
    window.localStorage.setItem("luwag:cookie-consent:v1", "denied");
    const { track, initMetaPixel } = await import("./tracking");
    initMetaPixel();
    track("ViewContent", { content_ids: ["sku-1"] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).fbq).toBeUndefined();
  });

  it("starts loading once consent is granted in the same page view", async () => {
    const { initMetaPixel } = await import("./tracking");
    const consent = await import("./consent");
    initMetaPixel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).fbq).toBeUndefined();

    consent.saveConsentChoice("granted");
    initMetaPixel();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    expect(w.fbq.queue).toContainEqual(["track", "PageView"]);
  });
});
