import { NextResponse, type NextRequest } from "next/server";
import { serverApiUrl } from "@/lib/api";

/**
 * Public short-link entrance: /s/<code> resolves through the backend and
 * redirects to the saved storefront path. Only root-relative targets are
 * followed, so a corrupted or tampered row can never become an open redirect.
 */
export const dynamic = "force-dynamic";

const SITE_ORIGIN = "https://luwag.shop";

/**
 * Meta appends its click parameters to whatever URL the ad points at. A short
 * link sits in between, so its redirect must carry those parameters through —
 * otherwise the landing page never sees `fbclid` (no `_fbc`, no CAPI match)
 * and the UTM columns stay empty. Only these names are forwarded; the saved
 * target always wins for every parameter it already defines, and `cl` can
 * never be injected or replaced from outside.
 */
const FORWARDED_PARAMS: ReadonlyArray<[key: string, pattern: RegExp]> = [
  ["aid", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/],
  ["adid", /^[A-Za-z0-9._-]{1,64}$/],
  ["ad_id", /^[A-Za-z0-9._-]{1,64}$/],
  ["fbclid", /^[A-Za-z0-9_-]{8,512}$/],
  ["utm_source", /^[\x20-\x7E]{1,120}$/],
  ["utm_medium", /^[\x20-\x7E]{1,120}$/],
  ["utm_campaign", /^[\x20-\x7E]{1,120}$/],
  ["utm_content", /^[\x20-\x7E]{1,120}$/],
  ["utm_term", /^[\x20-\x7E]{1,120}$/],
  ["utm_id", /^[A-Za-z0-9._-]{1,64}$/],
  ["campaign_id", /^[A-Za-z0-9._-]{1,64}$/],
  ["adset_id", /^[A-Za-z0-9._-]{1,64}$/],
];

/** Excludes `<`/`>` and control bytes while allowing names with spaces. */
function acceptableUtm(value: string): boolean {
  return /^[\x20-\x7E]{1,120}$/.test(value) && !value.includes("<") && !value.includes(">");
}

function mergeClickParams(request: NextRequest, target: string): string {
  const saved = new URL(target, SITE_ORIGIN);
  for (const [key, pattern] of FORWARDED_PARAMS) {
    if (saved.searchParams.has(key)) continue;
    for (const value of request.nextUrl.searchParams.getAll(key)) {
      const valid = key.startsWith("utm_") ? acceptableUtm(value) : pattern.test(value);
      if (valid) {
        saved.searchParams.set(key, value);
        break;
      }
    }
  }
  return `${saved.pathname}${saved.search}`;
}

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

  return NextResponse.redirect(new URL(mergeClickParams(request, target), publicOrigin(request)), 302);
}
