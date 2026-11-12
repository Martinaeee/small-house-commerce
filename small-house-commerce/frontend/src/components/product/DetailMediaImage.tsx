"use client";

import { useState } from "react";
import { useDesktopViewport } from "./useDesktopViewport";
import {
  optimizedUploadImage,
  optimizedUploadImageSrcSet,
  COLUMN_IMAGE_WIDTHS,
} from "@/lib/image-url";

/**
 * Phones: a detail strip authored for the desktop column (wide, ~2.4:1)
 * reads as a sliver at full width. Once the image reports a wide ratio, the
 * phone render swaps it into a horizontal viewer at a comfortable 4:3
 * height — the strip scales to that height and swipes through the rest, so
 * nothing is cropped and the copy stays readable. Desktop keeps the natural
 * full-width render. Both renders keep the responsive srcset.
 */
const WIDE_STRIP_RATIO = 1.6;

export function DetailMediaImage({
  url,
  alt,
  index,
  fullBleed,
}: {
  url: string;
  alt: string;
  index: number;
  fullBleed: boolean;
}) {
  const desktop = useDesktopViewport();
  const [ratio, setRatio] = useState<number | null>(null);
  const frame = fullBleed
    ? "-mx-4 w-[calc(100%+2rem)] max-w-none sm:mx-0 sm:w-full"
    : "w-full";
  const swipe = !desktop && ratio !== null && ratio >= WIDE_STRIP_RATIO;

  function measure(img: HTMLImageElement) {
    setRatio(
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : null,
    );
  }

  if (!swipe) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={optimizedUploadImage(url, 1280)}
        srcSet={optimizedUploadImageSrcSet(url, COLUMN_IMAGE_WIDTHS)}
        sizes="(min-width: 768px) 720px, 100vw"
        alt={alt}
        loading="lazy"
        onLoad={(event) => measure(event.currentTarget)}
        className={`${frame} block`}
        data-detail-index={index}
      />
    );
  }

  return (
    <div
      data-testid="detail-swipe"
      data-detail-index={index}
      className={`${frame} h-[75vw] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:h-auto sm:overflow-visible`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={optimizedUploadImage(url, 1280)}
        srcSet={optimizedUploadImageSrcSet(url, COLUMN_IMAGE_WIDTHS)}
        sizes="(min-width: 768px) 720px, 100vw"
        alt={alt}
        loading="lazy"
        onLoad={(event) => measure(event.currentTarget)}
        className="block h-full w-auto max-w-none"
      />
    </div>
  );
}
