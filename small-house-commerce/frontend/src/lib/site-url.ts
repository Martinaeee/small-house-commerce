/**
 * Single source of truth for the public storefront origin.
 *
 * `NEXT_PUBLIC_SITE_URL` is inlined at build time (a Next.js requirement for
 * NEXT_PUBLIC_* variables), so a domain change needs a frontend rebuild rather
 * than a runtime restart. It defaults to the production domain so local builds
 * and tests stay deterministic; the deploy overrides it through the frontend
 * Docker build arg (see docker-compose.prod.yml).
 *
 * Keep every absolute URL on the site — metadata, sitemap, robots, JSON-LD,
 * campaign links — derived from this module instead of hardcoding a host.
 */
const FALLBACK_SITE_URL = "https://luwag.shop";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || FALLBACK_SITE_URL
).replace(/\/+$/, "");

/** Turn a root-relative path into an absolute URL on the public origin. */
export function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}
