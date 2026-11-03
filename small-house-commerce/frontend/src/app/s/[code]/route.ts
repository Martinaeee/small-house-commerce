import { NextResponse, type NextRequest } from "next/server";
import { serverApiUrl } from "@/lib/api";

/**
 * Public short-link entrance: /s/<code> resolves through the backend and
 * redirects to the saved storefront path. Only root-relative targets are
 * followed, so a corrupted or tampered row can never become an open redirect.
 */
export const dynamic = "force-dynamic";

const SITE_ORIGIN = "https://luwag.shop";

function localTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const parsed = new URL(value, SITE_ORIGIN);
    if (parsed.origin !== SITE_ORIGIN) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function notFound(): Response {
  return new NextResponse("Short link not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/**
 * Caddy proxies to the container over the internal network, so request.url is
 * the bind address (http://0.0.0.0:3000) rather than the public host. Prefer
 * the forwarded origin and fall back to the request's own origin for local
 * runs and tests. Both values are validated before they reach a Location
 * header.
 */
function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();

  const proto = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : "https";
  if (forwardedHost && /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(forwardedHost)) {
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await context.params;
  const response = await fetch(
    serverApiUrl(`/api/v1/storefront/short-links/${encodeURIComponent(code)}`),
    { cache: "no-store" },
  );
  if (!response.ok) return notFound();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return notFound();
  }

  const target = localTarget((body as { target?: unknown } | null)?.target);
  if (!target) return notFound();

  return NextResponse.redirect(new URL(target, publicOrigin(request)), 302);
}
