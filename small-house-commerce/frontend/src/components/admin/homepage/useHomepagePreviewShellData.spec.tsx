import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetHomepagePreviewShellDataCacheForTests,
  useHomepagePreviewShellData,
} from "./useHomepagePreviewShellData";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site-settings";
import { DEFAULT_PUBLIC_STOREFRONT_SHELL } from "@/lib/storefront-shell";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetHomepagePreviewShellDataCacheForTests();
  vi.unstubAllGlobals();
});

describe("useHomepagePreviewShellData", () => {
  it("deduplicates Strict Mode replay and uses only public storefront endpoints", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/categories")) return response([]);
      if (path.endsWith("/collections")) return response({ items: [], total: 0 });
      if (path.endsWith("/settings")) return response(DEFAULT_SITE_SETTINGS);
      if (path.endsWith("/shell")) return response(DEFAULT_PUBLIC_STOREFRONT_SHELL);
      return response({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useHomepagePreviewShellData(), {
      wrapper: StrictMode,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.every((url) => url.startsWith("/api/v1/storefront/"))).toBe(true);
    expect(urls.some((url) => url.includes("/admin/"))).toBe(false);
  });
});
