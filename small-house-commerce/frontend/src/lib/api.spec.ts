import { afterEach, describe, expect, it, vi } from "vitest";
import { getAnnouncement } from "./api";

// Task 20: GET /storefront/announcement contract. The storefront layout
// consumes this helper, so the URL, the storefront ISR options and the
// null handling for the backend's empty 200 body are pinned here.

const PAYLOAD = {
  enabled: true,
  rotationMs: 5000,
  items: [
    {
      id: "00000000-0000-7000-8000-000000000021",
      text: "Free Metro Manila delivery",
      link: null,
      linkLabel: null,
      textColor: "#FFFFFF",
      backgroundColor: "#6b4f3a",
      schedule: { publishAt: null, unpublishAt: null },
      enabled: true,
      sortOrder: 0,
      linkHref: null,
    },
  ],
};

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
