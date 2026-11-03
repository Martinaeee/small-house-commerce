"use client";

import { useState, type CSSProperties } from "react";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { optimizedUploadImage } from "@/lib/image-url";

export function HomepageContentImage({ src, className, style }: { src: string; className?: string; style?: CSSProperties }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <PlaceholderImage label="" className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={src} src={optimizedUploadImage(src, 1440)} alt="" loading="lazy" className={className} style={style} onError={() => setFailedSrc(src)} />
  );
}
