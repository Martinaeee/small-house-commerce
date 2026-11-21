import { Logger } from '@nestjs/common';

/**
 * Image-cache warming bridge.
 *
 * A newly published product has no renditions in the Next.js image
 * optimizer's cache. The first phone that opens the PDP then asks for every
 * gallery and detail image at once, and the box (2 vCPUs in production) has
 * to run that many sharp transforms from cold: measured on the live site,
 * the tail of that queue waited 19 seconds. Safari gives up on a request
 * that slow, the response body arrives truncated, and the page renders a
 * broken image.
 *
 * So the admin write path warms the renditions itself, before any shopper
 * arrives: after a product is saved we ask the frontend's optimizer for the
 * exact widths the storefront renders. The requests are best-effort by
 * contract — a warm failure must never fail or delay the admin mutation, so
 * every error is swallowed (logged at warn level).
 *
 * When REVALIDATE_URL/REVALIDATE_SECRET are unset (local dev without the
 * bridge configured) the call is a no-op.
 */

const logger = new Logger('ImageWarming');

/** The optimizer route on the frontend that renders an upload at a width. */
export const IMAGE_WARM_PATH = '/_next/image';

/**
 * The widths real traffic actually requests, measured from the production
 * access log: 1280 dominates (every DPR-3 phone gallery slide), then 96
 * (thumbnails), 640 (cards), and 1440 (full-bleed scenes). The intermediate
 * srcset candidates (750/1080/1200) recorded zero requests, so warming them
 * would only spend the box's 2 vCPUs.
 */
const WARM_WIDTHS = [96, 384, 640, 1280, 1440] as const;

/** The optimizer quality the storefront requests. */
const WARM_QUALITY = 75;

/**
 * The optimizer caches one entry per output format, so a warm request that
 * does not advertise WebP fills the cache with an entry no browser reads.
 */
const BROWSER_IMAGE_ACCEPT =
  'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

/** Only uploads are optimizable; anything else is served as-is. */
const OPTIMIZABLE_PREFIX = '/uploads/';

function isOptimizable(url: string): boolean {
  return url.startsWith(OPTIMIZABLE_PREFIX);
}

type MediaRow = { url: string; type: string };
type ProductMediaRows = {
  images?: readonly MediaRow[] | null;
  detailBlocks?: readonly MediaRow[] | null;
};

/**
 * Every upload a PDP can show: gallery images and detail blocks, shared or
 * variant-scoped (a shopper who picks that variant gets those renditions,
 * so they must be warm too). Videos are dropped — the optimizer cannot
 * render them. Order is kept, duplicates collapse.
 */
export function collectProductMediaUrls(
  product: ProductMediaRows,
): string[] {
  const rows = [...(product.images ?? []), ...(product.detailBlocks ?? [])];
  return [
    ...new Set(
      rows
        .filter((row) => row.type === 'IMAGE')
        .map((row) => row.url.trim())
        .filter((url) => url !== ''),
    ),
  ];
}

/**
 * The optimizer URL for one upload at one width.
 *
 * The `url` parameter must be the raw path (the optimizer resolves it
 * against its own origin), and the path is percent-encoded because it is
 * carried inside a query string.
 */
function optimizerUrl(origin: string, url: string, width: number): string {
  return `${origin}${IMAGE_WARM_PATH}?url=${encodeURIComponent(url)}&w=${width}&q=${WARM_QUALITY}`;
}

/**
 * Every optimizer URL needed to render the given uploads at every width the
 * storefront uses. Unknown/duplicate uploads are dropped so the caller
 * never warms the same rendition twice.
 */
export function buildOptimizerWarmUrls(
  urls: readonly string[],
  origin = 'http://frontend:3000',
): string[] {
  const unique = [...new Set(urls.filter((url) => isOptimizable(url)))];
  return unique.flatMap((url) =>
    WARM_WIDTHS.map((width) => optimizerUrl(origin, url, width)),
  );
}

/**
 * Warm the optimizer cache for the given uploads.
 *
 * Fire-and-forget: resolves once every rendition has been requested (or has
 * failed), and never rejects.
 */
export async function warmProductImages(
  urls: readonly string[],
): Promise<void> {
  const base = process.env.REVALIDATE_URL?.trim();
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!base || !secret || urls.length === 0) return;

  const origin = base.replace(/\/+$/, '');
  const targets = buildOptimizerWarmUrls(urls, origin);
  if (targets.length === 0) return;

  const headers = {
    'x-revalidate-secret': secret,
    accept: BROWSER_IMAGE_ACCEPT,
  };

  // The optimizer serialises transforms internally; a small fan-out keeps
  // the box responsive while the cache fills.
  const CONCURRENCY = 4;
  let index = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, targets.length) },
    async () => {
      while (index < targets.length) {
        const target = targets[index];
        index += 1;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30_000);
          try {
            const res = await fetch(target, {
              headers,
              signal: controller.signal,
            });
            if (!res.ok) {
              logger.warn(`warm ${target.slice(0, 120)} -> HTTP ${res.status}`);
            }
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          logger.warn(
            `warm ${target.slice(0, 120)} failed: ${(error as Error).message}`,
          );
        }
      }
    },
  );

  await Promise.all(workers);
}
