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

  // Meta appends its click parameters to the ad's landing URL; a short link
  // must forward them or the pixel never sees the click id and the order
  // loses fbclid / utm attribution.
  it("forwards Meta click parameters while keeping the saved cl", async () => {
    stubBackend({ target: "/products/chair?variant=v1&cl=code" });

    const response = await GET(
      new NextRequest(
        "http://localhost/s/abc12345?aid=OP1&adid=120250687133730075&ad_id=99887766&fbclid=IwAR1234567890&utm_source=fb&utm_medium=paid&utm_campaign=spring&utm_content=ad1&utm_term=sofa&utm_id=120250&campaign_id=c1&adset_id=a1&cl=injected",
      ),
      context("abc12345"),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/products/chair");
    const params = location.searchParams;
    expect(params.get("cl")).toBe("code");
    expect(params.get("variant")).toBe("v1");
    expect(params.get("aid")).toBe("OP1");
    expect(params.get("adid")).toBe("120250687133730075");
    expect(params.get("ad_id")).toBe("99887766");
    expect(params.get("fbclid")).toBe("IwAR1234567890");
    expect(params.get("utm_source")).toBe("fb");
    expect(params.get("utm_medium")).toBe("paid");
    expect(params.get("utm_campaign")).toBe("spring");
    expect(params.get("utm_content")).toBe("ad1");
    expect(params.get("utm_term")).toBe("sofa");
    expect(params.get("utm_id")).toBe("120250");
    expect(params.get("campaign_id")).toBe("c1");
    expect(params.get("adset_id")).toBe("a1");
  });

  it("never lets incoming parameters override the saved target", async () => {
    stubBackend({ target: "/products/chair?cl=code&utm_source=fbpost&aid=SAVED" });

    const response = await GET(
      new NextRequest(
        "http://localhost/s/abc12345?cl=other&utm_source=ad&aid=NEW&fbclid=IwAR1234567890",
      ),
      context("abc12345"),
    );

    const params = new URL(response.headers.get("location") ?? "").searchParams;
    expect(params.get("cl")).toBe("code");
    expect(params.get("utm_source")).toBe("fbpost");
    expect(params.get("aid")).toBe("SAVED");
    // A parameter the target does not define is still forwarded.
    expect(params.get("fbclid")).toBe("IwAR1234567890");
  });

  it("drops malformed or oversized click parameters instead of forwarding them", async () => {
    stubBackend({ target: "/products/chair?cl=code" });

    const response = await GET(
      new NextRequest(
        `http://localhost/s/abc12345?fbclid=${"x".repeat(600)}&aid=bad aid&adid=name<script>&utm_source=${"u".repeat(200)}`,
      ),
      context("abc12345"),
    );

    const params = new URL(response.headers.get("location") ?? "").searchParams;
    expect(params.get("fbclid")).toBeNull();
    expect(params.get("aid")).toBeNull();
    expect(params.get("adid")).toBeNull();
    expect(params.get("utm_source")).toBeNull();
    expect(params.get("cl")).toBe("code");
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
