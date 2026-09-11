// src/components/product/ProductGallery.tsx
"use client";

import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

const DIRECT_THUMBS = 4;

interface Props {
  images: ProductImage[];
  active: number;
  onSelect: (index: number) => void;
  onOpenLightbox: (index: number) => void;
}

/**
 * PDP_SPEC §6.3 + refinement: main image opens the lightbox; up to four
 * thumbnails swap the main image; beyond four photos the fifth strip tile is
 * a "+N" entry into the lightbox (opens at index 4). A single placeholder
 * product is not interactive.
 */
export function ProductGallery({ images, active, onSelect, onOpenLightbox }: Props) {
  const hasRealImages = images.length > 0 && images.some((image) => image.url);
  const current = images[Math.min(active, images.length - 1)];
  const extra = images.length - DIRECT_THUMBS;

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
        onClick={() => onOpenLightbox(active)}
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
          {images.slice(0, DIRECT_THUMBS).map((image, index) => (
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
              onClick={() => onOpenLightbox(DIRECT_THUMBS)}
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
