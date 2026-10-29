// /uploads 只在生产由后端直出（原图 1–2.6MB PNG），统一走 Next 内置
// 优化器按需缩放并转 WebP；其余 URL 原样返回，不做任何包装。
export function optimizedUploadImage(url: string, width: number): string {
  if (!url.startsWith("/uploads/")) return url;
  const params = new URLSearchParams({ url, w: String(width), q: "75" });
  return `/_next/image?${params.toString()}`;
}
