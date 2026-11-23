// /uploads 只在生产由后端直出（原图 1–2.6MB PNG），/about 是随包发布的
// 2.8MB JPEG——两者都走 Next 内置优化器按需缩放并转 WebP；其余 URL 原样
// 返回，不做任何包装。云存储（腾讯 COS）启用后，媒体以绝对 URL 入库，
// NEXT_PUBLIC_MEDIA_BASE_URL 指向该域名，同样交给优化器处理，避免顾客
// 直接下载原图。
const OPTIMIZABLE_PREFIXES = ["/uploads/", "/about/"] as const;
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "").replace(/\/+$/, "");

/** Full-bleed media: hero banners, room scenes, brand story. */
export const FULL_BLEED_IMAGE_WIDTHS = [384, 640, 750, 1080, 1440] as const;
/** In-column media: product gallery, PDP detail blocks, about page. */
export const COLUMN_IMAGE_WIDTHS = [384, 640, 750, 1080, 1280] as const;

function isOptimizable(url: string): boolean {
  if (OPTIMIZABLE_PREFIXES.some((prefix) => url.startsWith(prefix))) return true;
  return MEDIA_BASE !== "" && url.startsWith(`${MEDIA_BASE}/`);
}

export function optimizedUploadImage(url: string, width: number): string {
  if (!isOptimizable(url)) return url;
  const params = new URLSearchParams({ url, w: String(width), q: "75" });
  return `/_next/image?${params.toString()}`;
}

/**
 * Candidate list for the same source at several widths. Pair with `sizes` so
 * the browser downloads the smallest rendition that covers the rendered slot:
 * a 390px phone should never fetch the 1440px master. Returns undefined for
 * URLs the optimizer does not handle, which lets the caller skip `srcSet`
 * entirely and keep the plain `src`.
 */
export function optimizedUploadImageSrcSet(
  url: string,
  widths: readonly number[],
): string | undefined {
  if (!isOptimizable(url)) return undefined;
  return widths
    .map((width) => `${optimizedUploadImage(url, width)} ${width}w`)
    .join(", ");
}
