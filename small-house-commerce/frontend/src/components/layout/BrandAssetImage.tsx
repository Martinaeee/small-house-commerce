"use client";

import { useState, type ReactNode } from "react";

export type BrandAssetImageProps = {
  src: string;
  width: number;
  height: number;
  alt: string;
  className?: string;
  fallback: ReactNode;
};

export function BrandAssetImage({
  src,
  width,
  height,
  alt,
  className = "",
  fallback,
}: BrandAssetImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) return fallback;

  return (
    // The backend already emits bounded brand derivatives with authoritative
    // dimensions; a plain image preserves their same-origin URL and SVG fallback.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={width}
      height={height}
      alt={alt}
      onError={() => setFailedSrc(src)}
      className={`object-contain ${className}`.trim()}
    />
  );
}
