import { describe, expect, it, vi } from "vitest";

import {
  FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA,
  loadHomepagePreviewShellData,
} from "./homepage-preview-shell-data";
import { DEFAULT_SITE_SETTINGS } from "./site-settings";
import { DEFAULT_PUBLIC_STOREFRONT_SHELL } from "./storefront-shell";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("loadHomepagePreviewShellData", () => {
  it("starts all public requests together and projects their successful data", async () => {
    const pending = new Map<
      string,
      { resolve(value: Response): void; promise: Promise<Response> }
    >();
    const fetcher = vi.fn((url: string | URL | Request) => {
      const key = String(url);
      let resolve!: (value: Response) => void;
      const promise = new Promise<Response>((done) => {
        resolve = done;
      });
      pending.set(key, { resolve, promise });
      return promise;
    });

    const loading = loadHomepagePreviewShellData({
      fetcher: fetcher as typeof fetch,
      urlFor: (path) => `https://storefront.test${path}`,
    });

    expect(fetcher).toHaveBeenCalledTimes(4);
    const urls = [...pending.keys()];
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://storefront.test/api/v1/storefront/categories",
        "https://storefront.test/api/v1/storefront/collections",
        "https://storefront.test/api/v1/storefront/settings",
        "https://storefront.test/api/v1/storefront/shell",
      ]),
    );
    expect(urls.some((url) => url.includes("/admin/"))).toBe(false);

    pending
      .get("https://storefront.test/api/v1/storefront/categories")!
      .resolve(
        response([
          {
            id: "living",
            name: "Living Room",
            slug: "living-room",
            imageUrl: null,
            children: [],
          },
        ]),
      );
    pending
      .get("https://storefront.test/api/v1/storefront/collections")!
      .resolve(response({ items: [], total: 0 }));
    pending
      .get("https://storefront.test/api/v1/storefront/settings")!
      .resolve(response({ ...DEFAULT_SITE_SETTINGS, supportPhone: "+63 2 8123" }));
    pending
      .get("https://storefront.test/api/v1/storefront/shell")!
      .resolve(response(DEFAULT_PUBLIC_STOREFRONT_SHELL));

    const result = await loading;
    expect(result.roots.map(({ id }) => id)).toEqual(["living"]);
    expect(result.collections).toEqual([]);
    expect(result.settings.supportPhone).toBe("+63 2 8123");
    expect(result.shell.brand.brandName).toBe("LUWAG");
    expect(result.degraded).toBe(false);
  });

  it("falls back independently when public shell resources fail", async () => {
    const fetcher = vi.fn(async () => response({ message: "down" }, 503));

    const result = await loadHomepagePreviewShellData({
      fetcher: fetcher as typeof fetch,
      urlFor: (path) => path,
    });

    expect(result).toEqual(FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA);
    expect(result.degraded).toBe(true);
    expect(result.settings).toEqual(DEFAULT_SITE_SETTINGS);
    expect(result.shell).toEqual(
      FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA.shell,
    );
  });
});
