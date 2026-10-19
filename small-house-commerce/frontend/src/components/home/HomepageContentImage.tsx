"use client";

import { useState } from "react";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

export function HomepageContentImage({ src, className }: { src: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <PlaceholderImage label="" className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={src} src={src} alt="" loading="lazy" className={className} onError={() => setFailedSrc(src)} />
  );
}
