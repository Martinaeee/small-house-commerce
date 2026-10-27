import { beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ hasAdsConsent: vi.fn<() => boolean>(() => true) }));
vi.mock("./consent", () => consent);

import { sendMetaServerEvent } from "./meta-capi";

const FBP = "fb.1.1753000000000.1098115397";

function clearMetaCookies() {
  for (const name of ["_fbp", "_fbc"]) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe("server-side event bridge", () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    consent.hasAdsConsent.mockReturnValue(true);
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    clearMetaCookies();
    window.history.replaceState({}, "", "/products/chair");
  });

  it("posts the consented event with its id, data and browser cookies", () => {
    document.cookie = `_fbp=${FBP}; path=/`;
    sendMetaServerEvent({
      name: "ViewContent",
      eventId: "evt-0001-abcd",
      data: { content_ids: ["sku-1"], value: 1299, currency: "PHP" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/storefront/meta-events");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      name: "ViewContent",
      eventId: "evt-0001-abcd",
      customData: { content_ids: ["sku-1"], value: 1299, currency: "PHP" },
      eventSourceUrl: "http://localhost:3000/products/chair",
      fbp: FBP,
      fbc: null,
      consent: true,
    });
  });

  it("derives _fbc from a fbclid landing and keeps it for later events", () => {
    window.history.replaceState({}, "", "/products/chair?fbclid=IwARtestClick");
    sendMetaServerEvent({ name: "AddToCart", eventId: "evt-0002-abcd", data: {} });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.fbc).toMatch(/^fb\.1\.\d+\.IwARtestClick$/);
    expect(document.cookie).toContain("_fbc=fb.1.");
  });

  it("does nothing without ads consent", () => {
    consent.hasAdsConsent.mockReturnValue(false);
    sendMetaServerEvent({ name: "AddToCart", eventId: "evt-0003-abcd", data: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses malformed tracking cookies instead of forwarding them", () => {
    document.cookie = "_fbp=garbage; path=/";
    sendMetaServerEvent({ name: "ViewContent", eventId: "evt-0004-abcd", data: {} });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.fbp).toBeNull();
  });

  it("never throws into the shopper's page when the bridge fails", () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(() =>
      sendMetaServerEvent({ name: "ViewContent", eventId: "evt-0005-abcd", data: {} }),
    ).not.toThrow();
  });
});
