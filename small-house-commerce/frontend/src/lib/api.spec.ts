import { afterEach, describe, expect, it, vi } from "vitest";
import { api, getAnnouncement, type AnnouncementBlockView } from "./api";

const PAYLOAD = {
  enabled: true,
  rotationMs: 5000,
  items: [
    {
      id: "00000000-0000-7000-8000-000000000021",
      text: "Free Metro Manila delivery",
      content: {
        version: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: "center" },
              content: [
                { type: "text", text: "Free Metro Manila delivery" },
              ],
            },
          ],
        },
      },
      link: null,
      linkLabel: null,
      textColor: "#FFFFFF",
      backgroundColor: "#6b4f3a",
      schedule: { publishAt: null, unpublishAt: null },
      countdown: {
        endsAt: "2026-10-15T00:00:00.000Z",
        color: null,
        fontFamily: "SANS",
        fontSize: "MD",
        fontWeight: 700,
      },
      enabled: true,
      sortOrder: 0,
      linkHref: null,
    },
  ],
} satisfies AnnouncementBlockView;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAnnouncement", () => {
  it("fetches the storefront announcement endpoint with the storefront ISR contract", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAnnouncement()).resolves.toEqual(PAYLOAD);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/storefront/announcement"),
      expect.objectContaining({
        next: { revalidate: 120, tags: ["storefront"] },
      }),
    );
  });

  it("resolves null for the empty 200 body the backend sends when nothing is active", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    await expect(getAnnouncement()).resolves.toBeNull();
  });

  it("resolves null for a literal JSON null body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 200 })));

    await expect(getAnnouncement()).resolves.toBeNull();
  });

  it("rejects on a non-OK response so the layout can hide the bar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Internal error" }, 500)),
    );

    await expect(getAnnouncement()).rejects.toThrow("Internal error");
  });
});

describe("signed marketing credential transport", () => {
  it("posts public touches without caching or forwarding a referrer", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ credential: "server.credential", expiresAt: "2099-01-01T00:00:00Z" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.marketingTouch({ code: "abcdefghijklmnop", path: "/products/chair", visitKey: "tab-1" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/storefront/marketing-touch"), expect.objectContaining({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ code: "abcdefghijklmnop", path: "/products/chair", visitKey: "tab-1" });
  });


  it("sends the credential at the order request root, not as a raw owner attribution", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ orderNumber: "PH1", orderStatus: "NEW" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.createOrder({ customer: { name: "Jane", phone: "09171234567", province: "Metro Manila", city: "Manila", streetAddress: "1 Main St" }, items: [{ skuId: "sku-1", quantity: 1 }], marketingCredential: "server.credential" } as Parameters<typeof api.createOrder>[0]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.marketingCredential).toBe("server.credential");
    expect(body.attribution).toEqual({ sourceType: "ORGANIC" });
  });

  it("sends the order note at the request root and defaults it to null", async () => {
    // mockImplementation so each call gets a fresh, unread Response body.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ orderNumber: "PH1", orderStatus: "NEW" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.createOrder({
      customer: { name: "Jane", phone: "09171234567", province: "Metro Manila", city: "Manila", streetAddress: "1 Main St" },
      items: [{ skuId: "sku-1", quantity: 1 }],
      customerNote: "Call before delivery",
    } as Parameters<typeof api.createOrder>[0]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.customerNote).toBe("Call before delivery");

    await api.createOrder({
      customer: { name: "Jane", phone: "09171234567", province: "Metro Manila", city: "Manila", streetAddress: "1 Main St" },
      items: [{ skuId: "sku-1", quantity: 1 }],
    } as Parameters<typeof api.createOrder>[0]);
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(second.customerNote).toBeNull();
  });
});

describe("idempotency key transport", () => {
  it("forwards the checkout retry key and defaults it to null", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse({ orderNumber: "PH1", orderStatus: "NEW", confirmationStatus: "UNCONFIRMED" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const key = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    await api.createOrder({
      customer: { name: "Jane", phone: "09171234567", province: "Metro Manila", city: "Manila", streetAddress: "1 Main St" },
      items: [{ skuId: "sku-1", quantity: 1 }],
      idempotencyKey: key,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).idempotencyKey).toBe(key);

    await api.createOrder({
      customer: { name: "Jane", phone: "09171234567", province: "Metro Manila", city: "Manila", streetAddress: "1 Main St" },
      items: [{ skuId: "sku-1", quantity: 1 }],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).idempotencyKey).toBeNull();
  });
});
