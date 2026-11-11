"use client";

import { useState, type CSSProperties } from "react";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { optimizedUploadImage, optimizedUploadImageSrcSet } from "@/lib/image-url";

const CONTENT_WIDTHS = [384, 640, 750, 1080, 1440] as const;

export function HomepageContentImage({
  src,
  className,
  style,
  sizes = "100vw",
}: {
  src: string;
  className?: string;
  style?: CSSProperties;
  /** Rendered slot width per breakpoint; lets the browser pick a smaller file. */
  sizes?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <PlaceholderImage label="" className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={optimizedUploadImage(src, 1440)}
      srcSet={optimizedUploadImageSrcSet(src, CONTENT_WIDTHS)}
      sizes={sizes}
      alt=""
      loading="lazy"
      className={className}
      style={style}
      onError={() => setFailedSrc(src)}
    />
  );
}
