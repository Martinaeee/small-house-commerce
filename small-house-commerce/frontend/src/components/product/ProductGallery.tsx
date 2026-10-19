// src/components/product/ProductGallery.tsx
"use client";

import { useRef } from "react";
import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { ViewportVideo } from "./ViewportVideo";

interface Props {
  images: ProductImage[];
  active: number;
  onSelect: (index: number) => void;
  onOpenLightbox: (index: number) => void;
}

/** A horizontal touch gesture shorter than this is a tap or a jiggle. */
const SWIPE_THRESHOLD_PX = 40;

/** Play glyph for video gallery entries. */
function PlayBadge() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex items-center justify-center text-2xl text-white drop-shadow"
    >
      ▶
    </span>
  );
}

/**
 * PDP_SPEC §6.3 + refinement: main media opens the lightbox. With 1–5 entries
 * all thumbnails are shown directly (up to five); with 6+ the strip shows four
 * direct thumbnails followed by a "+N" tile (N = total − 4) that opens the
 * lightbox at index 4. Gallery entries can be photos or short videos — the
 * stage shows the video's first frame with a play badge (playback happens in
 * the lightbox); a placeholder-only product is not interactive.
 */
export function ProductGallery({ images, active, onSelect, onOpenLightbox }: Props) {
  const hasRealImages = images.length > 0 && images.some((image) => image.url);
  const current = images[Math.min(active, images.length - 1)];
  const directCount = images.length > 5 ? 4 : Math.min(5, images.length);
  const extra = images.length > 5 ? images.length - 4 : 0;
  // Touch swipe: remember where the finger went down and whether the click
  // that follows a swipe must not open the lightbox.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  if (!hasRealImages) {
    return (
      <div className="-mx-4 overflow-hidden sm:mx-0 sm:rounded-lg">
        <PlaceholderImage label="" className="aspect-square w-full" />
      </div>
    );
  }

  const openActive = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpenLightbox(Math.min(active, images.length - 1));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A mostly-vertical or tiny gesture stays a scroll/tap, not a swipe.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) {
      return;
    }
    // The browser fires a click after the gesture; it must not open the
    // lightbox on top of the image that just slid in.
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    const next = dx < 0 ? active + 1 : active - 1;
    if (next >= 0 && next < images.length) onSelect(next);
  };

  return (
    // Full-bleed on phones (the page supplies px-4), framed column from sm up.
    <div className="-mx-4 flex flex-col gap-4 sm:mx-0">
      <button
        type="button"
        onClick={openActive}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStartRef.current = null;
        }}
        aria-label="Open image gallery"
        className="relative touch-pan-y overflow-hidden"
      >
        {current.type === "VIDEO" ? (
          <ViewportVideo
            key={current.id}
            src={current.url}
            mode="TEASER"
            ariaLabel={current.altText ?? "Product video"}
            controls={false}
            className="pointer-events-none aspect-square w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={current.altText ?? "Product image"}
            className="aspect-square w-full object-cover"
          />
        )}
        {current.type === "VIDEO" && <PlayBadge />}
      </button>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.slice(0, directCount).map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`View media ${index + 1}`}
              className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors sm:h-20 sm:w-20 ${
                index === active ? "border-cta" : "border-border hover:border-primary"
              }`}
            >
              {image.type === "VIDEO" ? (
                <span className="absolute inset-0 bg-black">
                  <PlayBadge />
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt="" className="h-full w-full object-cover" />
              )}
            </button>
          ))}

          {extra > 0 && (() => {
            // The overflow tile previews the media it hides instead of a flat
            // colour block: the fifth entry becomes its backdrop.
            const preview = images[directCount];
            return (
              <button
                type="button"
                onClick={() => onOpenLightbox(directCount)}
                aria-label={`View all ${images.length} photos and videos`}
                className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-border text-sm font-semibold text-white transition-colors hover:border-primary sm:h-20 sm:w-20"
              >
                {preview?.type === "IMAGE" && preview.url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview.url}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <span aria-hidden className="absolute inset-0 bg-black/45" />
                  </>
                ) : (
                  <span aria-hidden className="absolute inset-0 bg-black/70" />
                )}
                <span className="relative">+{extra}</span>
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}
