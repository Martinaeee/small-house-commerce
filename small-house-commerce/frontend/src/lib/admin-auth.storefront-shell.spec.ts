import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installLocalStorage(refreshToken = "refresh-token") {
  const values = new Map<string, string>([["sh_admin_refresh", refreshToken]]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adminAuthedFetchOnce", () => {
  it("proactively refreshes once, sends a mutation once, and preserves a 409 body", async () => {
    const conflict = {
      code: "SHELL_VERSION_MISMATCH",
      message: "The storefront shell draft changed in another session",
      currentVersion: 9,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: "fresh-access",
          refreshToken: "rotated-refresh",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(conflict, 409));
    vi.stubGlobal("fetch", fetchMock);
    const { AdminApiError, adminAuthedFetchOnce } = await import("./admin-auth");

    const error = await adminAuthedFetchOnce(
      "/api/v1/admin/storefront-shell/publish",
      { method: "POST", body: JSON.stringify({ expectedVersion: 7 }) },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ status: 409, body: conflict });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/auth/refresh",
      "/api/v1/admin/storefront-shell/publish",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fresh-access",
    });
  });

  it("never replays a non-idempotent mutation after its one request returns 401", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: "fresh-access",
          refreshToken: "rotated-refresh",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const { AdminApiError, adminAuthedFetchOnce } = await import("./admin-auth");

    const error = await adminAuthedFetchOnce(
      "/api/v1/admin/storefront-shell/upload?slot=square",
      { method: "POST", body: new Uint8Array([1, 2, 3]) },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/v1/admin/storefront-shell/upload?slot=square",
      ),
    ).toHaveLength(1);
  });
});
