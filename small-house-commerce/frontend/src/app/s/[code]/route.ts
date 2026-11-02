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

  return NextResponse.redirect(new URL(target, request.url), 302);
}
