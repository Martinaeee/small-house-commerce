// src/components/product/ProductGallery.tsx
"use client";

import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

interface Props {
  images: ProductImage[];
  active: number;
  onSelect: (index: number) => void;
  onOpenLightbox: (index: number) => void;
}

/**
 * PDP_SPEC §6.3 + refinement: main image opens the lightbox. With 1–5 photos
 * all thumbnails are shown directly (up to five); with 6+ photos the strip
 * shows four direct thumbnails followed by a "+N" tile (N = total − 4) that
 * opens the lightbox at index 4. A single placeholder product is not
 * interactive.
 */
export function ProductGallery({ images, active, onSelect, onOpenLightbox }: Props) {
  const hasRealImages = images.length > 0 && images.some((image) => image.url);
  const current = images[Math.min(active, images.length - 1)];
  const directCount = images.length > 5 ? 4 : Math.min(5, images.length);
  const extra = images.length > 5 ? images.length - 4 : 0;

  if (!hasRealImages) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <PlaceholderImage label="" className="aspect-square w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onOpenLightbox(Math.min(active, images.length - 1))}
        aria-label="Open image gallery"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.altText ?? "Product image"}
          className="aspect-square w-full object-cover"
        />
      </button>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.slice(0, directCount).map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`View image ${index + 1}`}
              className={`h-20 w-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                index === active ? "border-cta" : "border-border hover:border-primary"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}

          {extra > 0 && (
            <button
              type="button"
              onClick={() => onOpenLightbox(directCount)}
              aria-label={`View all ${images.length} photos`}
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border-2 border-border bg-primary-light/40 text-sm font-semibold text-cta hover:border-primary"
            >
              +{extra}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
