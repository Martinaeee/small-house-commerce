import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { DEFAULT_BRAND_MARK_SVG, DEFAULT_BRAND_MARK_VERSION } from "@/lib/default-brand-mark";

const shellMock = vi.hoisted(() => ({
  fetchStorefrontShell: vi.fn(),
}));

vi.mock("@/lib/storefront-shell", () => shellMock);

import { dynamic, GET } from "./route";

const IDS = {
  square: "018f0000-0000-7000-8000-000000000001",
};
const CDN_MARK = "https://cdn.example/mark.png";
const PNG_BYTES = [137, 80, 78, 71];
const MAX_BRAND_MARK_BYTES = 2 * 1024 * 1024;

function shellWithSquare({
  revision,
  id = IDS.square,
  url = CDN_MARK,
}: {
  revision: number;
  id?: string;
  url?: string;
}): PublicStorefrontShell {
  return {
    publishedRevision: revision,
    brand: {
      brandName: "LUWAG",
      horizontalLogo: null,
      squareMark: { id, url, width: 512, height: 512 },
    },
    header: { items: [] },
    footer: {
      tagline: "Small-space furniture, made roomy",
      description: "Furniture for Filipino condos and rentals.",
      columns: [],
      copyrightBrand: "LUWAG Living",
      socials: [],
      legal: [],
      payments: [],
    },
    theme: {
      primary: "#c9a77b",
      action: "#6b4f3a",
      background: "#faf8f5",
      surface: "#ffffff",
      text: "#222222",
      headingFont: "SYSTEM",
      bodyFont: "SYSTEM",
    },
    derivedTheme: {
      primaryDark: "#b8946a",
      primaryLight: "#e8dccb",
      actionHover: "#5a4130",
      textSecondary: "#666666",
      textMuted: "#999999",
      border: "#e8e2d9",
      focus: "#6b4f3a",
      disabled: "#999999",
      actionForeground: "#ffffff",
    },
  };
}

function pngResponse(bytes = PNG_BYTES, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(bytes.length),
      ...headers,
    },
  });
}

function arrangeFailedBrandObject(
  failure: "network" | "wrong-type" | "oversized" | "redirect",
): void {
  shellMock.fetchStorefrontShell.mockResolvedValue(shellWithSquare({ revision: 7 }));
  const fetchMock = vi.fn();
  if (failure === "network") fetchMock.mockRejectedValue(new Error("offline"));
  if (failure === "wrong-type") {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "2" },
      }),
    );
  }
  if (failure === "oversized") {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(MAX_BRAND_MARK_BYTES + 1),
        },
      }),
    );
  }
  if (failure === "redirect") {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/mark.png" },
      }),
    );
  }
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.clearAllMocks();
  shellMock.fetchStorefrontShell.mockResolvedValue(shellWithSquare({ revision: 7 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /brand-mark", () => {
  it("is explicitly request-time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("proxies the published square PNG with an asset ETag and safe headers", async () => {
    shellMock.fetchStorefrontShell.mockResolvedValue(
      shellWithSquare({ revision: 7, id: IDS.square, url: CDN_MARK }),
    );
    const fetchMock = vi.fn().mockResolvedValue(pngResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/brand-mark"));

    expect(shellMock.fetchStorefrontShell).toHaveBeenCalledWith({
      cache: "no-store",
    });
    expect(response.headers.get("etag")).toBe(
      `"shell-r7-asset-${IDS.square}"`,
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(PNG_BYTES);
    expect(fetchMock).toHaveBeenCalledWith(
      CDN_MARK,
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("resolves a backend-relative local mark against API_TARGET", async () => {
    vi.stubEnv("API_TARGET", "http://127.0.0.1:3230");
    shellMock.fetchStorefrontShell.mockResolvedValue(
      shellWithSquare({
        revision: 8,
        id: IDS.square,
        url: "/uploads/brand/2026/mark.png",
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue(pngResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/brand-mark"));

    expect(response.headers.get("etag")).toBe(
      `"shell-r8-asset-${IDS.square}"`,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3230/uploads/brand/2026/mark.png",
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });

  it("returns 304 only after selecting the same successful payload and ETag", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pngResponse()));

    const response = await GET(
      new NextRequest("http://localhost/brand-mark", {
        headers: {
          "if-none-match": `"shell-r7-asset-${IDS.square}"`,
        },
      }),
    );

    expect(response.status).toBe(304);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get("etag")).toBe(
      `"shell-r7-asset-${IDS.square}"`,
    );
  });

  it.each(["network", "wrong-type", "oversized", "redirect"] as const)(
    "returns built-in SVG with a default ETag for %s object failure",
    async (failure) => {
      arrangeFailedBrandObject(failure);

      const response = await GET(new NextRequest("http://localhost/brand-mark"));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/svg+xml");
      expect(response.headers.get("etag")).toBe(
        `"shell-r7-default-${DEFAULT_BRAND_MARK_VERSION}"`,
      );
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).toBe(DEFAULT_BRAND_MARK_SVG);
    },
  );

  it("enforces the stream cap when Content-Length is absent or lying", async () => {
    const oversized = new Uint8Array(MAX_BRAND_MARK_BYTES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(oversized, {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "4" },
        }),
      ),
    );

    const response = await GET(new NextRequest("http://localhost/brand-mark"));

    expect(response.headers.get("etag")).toBe(
      `"shell-r7-default-${DEFAULT_BRAND_MARK_VERSION}"`,
    );
    expect(await response.text()).toBe(DEFAULT_BRAND_MARK_SVG);
  });

  it("uses the revisioned default payload without requesting an absent asset", async () => {
    shellMock.fetchStorefrontShell.mockResolvedValue({
      ...shellWithSquare({ revision: 11 }),
      brand: {
        ...shellWithSquare({ revision: 11 }).brand,
        squareMark: null,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/brand-mark"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("etag")).toBe(
      `"shell-r11-default-${DEFAULT_BRAND_MARK_VERSION}"`,
    );
    expect(await response.text()).toBe(DEFAULT_BRAND_MARK_SVG);
  });

  it("does not honor revision N's ETag after publication selects N+1 bytes", async () => {
    shellMock.fetchStorefrontShell
      .mockResolvedValueOnce(shellWithSquare({ revision: 7, url: "https://cdn.example/v7.png" }))
      .mockResolvedValueOnce(shellWithSquare({ revision: 8, url: "https://cdn.example/v8.png" }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(pngResponse([7]))
        .mockResolvedValueOnce(pngResponse([8])),
    );

    const first = await GET(new NextRequest("http://localhost/brand-mark"));
    const second = await GET(
      new NextRequest("http://localhost/brand-mark", {
        headers: { "if-none-match": first.headers.get("etag")! },
      }),
    );

    expect(first.headers.get("etag")).toBe(
      `"shell-r7-asset-${IDS.square}"`,
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("etag")).toBe(
      `"shell-r8-asset-${IDS.square}"`,
    );
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([8]);
  });
});
