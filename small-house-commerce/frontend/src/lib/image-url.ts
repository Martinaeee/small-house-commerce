// /uploads 只在生产由后端直出（原图 1–2.6MB PNG），/about 是随包发布的
// 2.8MB JPEG——两者都走 Next 内置优化器按需缩放并转 WebP；其余 URL 原样
// 返回，不做任何包装。
const OPTIMIZABLE_PREFIXES = ["/uploads/", "/about/"] as const;

export function optimizedUploadImage(url: string, width: number): string {
  if (!OPTIMIZABLE_PREFIXES.some((prefix) => url.startsWith(prefix))) return url;
  const params = new URLSearchParams({ url, w: String(width), q: "75" });
  return `/_next/image?${params.toString()}`;
}
