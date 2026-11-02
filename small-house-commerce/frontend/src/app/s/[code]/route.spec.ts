import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dynamic, GET } from "./route";

const context = (code: string) => ({ params: Promise.resolve({ code }) });

function stubBackend(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /s/[code]", () => {
  it("is explicitly request-time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("redirects to the saved storefront target with a 302", async () => {
    vi.stubEnv("API_TARGET", "http://127.0.0.1:3230");
    const fetchMock = stubBackend({ target: "/products/chair?variant=v1&cl=code" });

    const response = await GET(new NextRequest("http://localhost/s/abc12345"), context("abc12345"));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3230/api/v1/storefront/short-links/abc12345",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost/products/chair?variant=v1&cl=code",
    );
  });

  it("uses the public origin Caddy forwarded, not the container bind address", async () => {
    stubBackend({ target: "/products/chair?variant=v1&cl=code" });

    const response = await GET(
      new NextRequest("http://0.0.0.0:3000/s/abc12345", {
        headers: { "x-forwarded-host": "luwag.shop", "x-forwarded-proto": "https" },
      }),
      context("abc12345"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://luwag.shop/products/chair?variant=v1&cl=code",
    );
  });

  it("ignores an injected forwarded host", async () => {
    stubBackend({ target: "/products/chair" });

    const response = await GET(
      new NextRequest("http://localhost/s/abc12345", {
        headers: { "x-forwarded-host": "evil.com/", "x-forwarded-proto": "javascript" },
      }),
      context("abc12345"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/products/chair");
  });

  it("encodes the short code in the backend request", async () => {
    vi.stubEnv("API_TARGET", "http://127.0.0.1:3230");
    const fetchMock = stubBackend({ target: "/products/chair" });

    await GET(new NextRequest("http://localhost/s/a%2Fb"), context("a/b"));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3230/api/v1/storefront/short-links/a%2Fb",
      expect.anything(),
    );
  });

  it("returns 404 when the backend does not know the code", async () => {
    stubBackend({ message: "Not Found" }, 404);

    const response = await GET(new NextRequest("http://localhost/s/missing1"), context("missing1"));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  const unsafeTargets: Array<[unknown, string]> = [
    ["https://evil.com/phish", "an absolute off-site target"],
    ["//evil.com/phish", "a protocol-relative target"],
    ["javascript:alert(1)", "a script target"],
    ["/\\evil.com/phish", "a backslash host trick"],
    ["", "a missing target"],
    [null, "a non-string target"],
  ];
  it.each(unsafeTargets)("refuses to redirect to %s (%s)", async (target) => {
    stubBackend({ target });

    const response = await GET(new NextRequest("http://localhost/s/abc12345"), context("abc12345"));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
