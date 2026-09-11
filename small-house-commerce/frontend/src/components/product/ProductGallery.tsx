"use client";

import { useState } from "react";
import type { Product, ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

/**
 * PDP_SPEC §6.3 Thumbnail Gallery. Main image is 1:1 (DESIGN_SYSTEM §13),
 * thumbnails switch the main view. Until real photography lands, images come
 * from the backend array (empty -> placeholder).
 */
export function ProductGallery({ product }: { product: Product }) {
  const images: ProductImage[] = product.images.length > 0
    ? product.images
    : [{ id: "placeholder", url: "", altText: product.name, sortOrder: 0 }];

  const [active, setActive] = useState(0);
  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {current.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={current.altText ?? product.name}
            className="aspect-square w-full object-cover"
          />
        ) : (
          <PlaceholderImage label={product.name} className="aspect-square w-full" />
        )}
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`View image ${index + 1}`}
              className={`h-20 w-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                index === active ? "border-cta" : "border-border hover:border-primary"
              }`}
            >
              {image.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <PlaceholderImage label="" className="h-full w-full" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
