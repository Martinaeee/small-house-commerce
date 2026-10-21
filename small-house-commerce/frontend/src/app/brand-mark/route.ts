import type { NextRequest } from "next/server";
import { serverApiUrl } from "@/lib/api";
import { DEFAULT_BRAND_MARK_SVG } from "@/lib/default-brand-mark";
import { fetchStorefrontShell } from "@/lib/storefront-shell";

export const dynamic = "force-dynamic";

const MAX_BRAND_MARK_BYTES = 2 * 1024 * 1024;
const BRAND_MARK_TIMEOUT_MS = 3_000;
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SelectedBrandMark = {
  body: BodyInit;
  contentType: string;
  etag: string;
};

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array | null> {
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BRAND_MARK_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function selectPublishedMark(): Promise<SelectedBrandMark> {
  let publishedRevision = 0;
  let squareMark: Awaited<ReturnType<typeof fetchStorefrontShell>>["brand"]["squareMark"] =
    null;

  try {
    // A request-time brand mark must select the current publication before it
    // evaluates If-None-Match. The shared shell fetch is tagged for page
    // rendering, but even a force-dynamic route can otherwise reuse that data
    // cache entry during a publication/revalidation boundary.
    const shell = await fetchStorefrontShell({ cache: "no-store" });
    publishedRevision = shell.publishedRevision;
    squareMark = shell.brand.squareMark;
  } catch {
    // The built-in payload remains available even if a test double or an
    // unexpected local failure bypasses fetchStorefrontShell's own fallback.
  }

  if (squareMark && ASSET_ID.test(squareMark.id)) {
    try {
      // Local uploads are stored as backend-relative `/uploads/...` URLs. Route
      // handlers run in Node, where relative fetch URLs are invalid, so resolve
      // those through the same API target used by server components. R2/CDN
      // assets remain absolute and are fetched as published.
      const markUrl = squareMark.url.startsWith("/")
        ? serverApiUrl(squareMark.url)
        : squareMark.url;
      const response = await fetch(markUrl, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(BRAND_MARK_TIMEOUT_MS),
      });
      const contentType =
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
        "";
      const rawLength = response.headers.get("content-length");
      const declaredLength = rawLength === null ? null : Number(rawLength);
      const tooLarge =
        declaredLength !== null &&
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_BRAND_MARK_BYTES;

      if (response.ok && contentType === "image/png" && !tooLarge) {
        const bytes = await readBounded(response.body);
        if (bytes) {
          return {
            body: ownedArrayBuffer(bytes),
            contentType: "image/png",
            etag: `"shell-r${publishedRevision}-asset-${squareMark.id}"`,
          };
        }
      }
    } catch {
      // Network, redirect and timeout failures all select the built-in SVG.
    }
  }

  return {
    body: DEFAULT_BRAND_MARK_SVG,
    contentType: "image/svg+xml; charset=utf-8",
    etag: `"shell-r${publishedRevision}-default"`,
  };
}

function responseHeaders(selected: SelectedBrandMark): Headers {
  return new Headers({
    "Cache-Control": "no-cache",
    "Content-Type": selected.contentType,
    ETag: selected.etag,
    "X-Content-Type-Options": "nosniff",
  });
}

function validatorMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .includes(etag);
}

export async function GET(request: NextRequest): Promise<Response> {
  const selected = await selectPublishedMark();
  const headers = responseHeaders(selected);

  if (validatorMatches(request.headers.get("if-none-match"), selected.etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(selected.body, { status: 200, headers });
}
