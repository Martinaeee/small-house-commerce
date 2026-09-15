import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * Internal on-demand revalidation endpoint called by the backend after an
 * admin write (review/product/LP/category mutations). Not under /api/v1, so
 * Caddy routes it to this Next app rather than the Nest backend.
 *
 * Auth: shared secret via x-revalidate-secret (REVALIDATE_SECRET must be set
 * on both services). `{ expire: 0 }` makes the next shopper request block on
 * regeneration, so changes appear immediately instead of via SWR.
 */

// Only these tags can ever be invalidated through this endpoint.
const ALLOWED_TAGS = new Set<string>([CACHE_TAGS.STOREFRONT]);

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "revalidation disabled" }, { status: 503 });
  }
  const provided = request.headers.get("x-revalidate-secret") ?? "";
  if (!timingSafeEqualStr(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const rawTags = (body as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(rawTags)) {
    return NextResponse.json({ error: "tags must be an array" }, { status: 400 });
  }

  const tags = [...new Set(rawTags)].filter(
    (tag): tag is string => typeof tag === "string" && ALLOWED_TAGS.has(tag),
  );
  if (tags.length === 0) {
    return NextResponse.json({ error: "no allowed tags" }, { status: 400 });
  }

  for (const tag of tags) {
    // Block the NEXT request until fresh data is rendered (no stale serving).
    revalidateTag(tag, { expire: 0 });
  }

  return NextResponse.json({ revalidated: true, tags });
}
