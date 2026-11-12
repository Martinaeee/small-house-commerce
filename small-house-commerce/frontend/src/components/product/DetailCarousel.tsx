"use client";

import { useRef, useState } from "react";
import { ViewportVideo } from "./ViewportVideo";
import type { DetailBlockLike } from "./pdp-detail-blocks";
import {
  optimizedUploadImage,
  optimizedUploadImageSrcSet,
  COLUMN_IMAGE_WIDTHS,
} from "@/lib/image-url";

/**
 * One swipeable detail module (consecutive blocks sharing a group key):
 * full-width snap slides, height locked to the first image once it loads so
 * differently-shaped slides stay centered without cropping, dots on every
 * device and arrows on desktop only — the Amazon A+ module pattern.
 */
export function DetailCarousel({
  blocks,
  fullBleed,
  index,
}: {
  blocks: readonly DetailBlockLike[];
  fullBleed: boolean;
  index: number;
}) {
  const frame = fullBleed
    ? "-mx-4 w-[calc(100%+2rem)] max-w-none sm:mx-0 sm:w-full"
    : "w-full";
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // Null until the first image paints at full width; the track then keeps
  // that height so mixed-ratio slides letterbox instead of shifting.
  const [fixedHeight, setFixedHeight] = useState<number | null>(null);

  function scrollToSlide(target: number) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: track.clientWidth * target, behavior: "smooth" });
  }

  return (
    <div
      data-testid="detail-carousel"
      data-detail-index={index}
      className={`${frame} relative`}
      role="group"
      aria-roledescription="carousel"
      aria-label="Product detail images"
    >
      <div
        ref={trackRef}
        data-testid="detail-carousel-track"
        tabIndex={0}
        aria-label="Product detail images"
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-cta"
        style={fixedHeight ? { height: fixedHeight } : undefined}
        onScroll={(event) => {
          const track = event.currentTarget;
          const width = track.clientWidth;
          if (width <= 0) return;
          setActive(
            Math.min(
              blocks.length - 1,
              Math.max(0, Math.round(track.scrollLeft / width)),
            ),
          );
        }}
      >
        {blocks.map((block, slide) => (
          <div
            key={`${block.url}-${slide}`}
            data-carousel-slide
            className="flex w-full shrink-0 snap-center items-center justify-center"
          >
            {block.type === "VIDEO" ? (
              <ViewportVideo
                src={block.url}
                mode="CONTENT"
                ariaLabel={block.altText ?? "Product detail video"}
                className="max-h-full max-w-full bg-black"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={optimizedUploadImage(block.url, 1280)}
                srcSet={optimizedUploadImageSrcSet(block.url, COLUMN_IMAGE_WIDTHS)}
                sizes="(min-width: 768px) 720px, 100vw"
                alt={block.altText ?? ""}
                loading={slide === 0 ? "eager" : "lazy"}
                onLoad={
                  slide === 0
                    ? (event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        if (rect.height > 0) setFixedHeight(rect.height);
                      }
                    : undefined
                }
                className={slide === 0 ? "block w-full h-auto" : "max-h-full max-w-full object-contain"}
              />
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        aria-label="Previous detail image"
        disabled={active === 0}
        onClick={() => scrollToSlide(active - 1)}
        className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-ink shadow-sm transition-colors hover:text-cta disabled:opacity-40 lg:flex"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Next detail image"
        disabled={active === blocks.length - 1}
        onClick={() => scrollToSlide(active + 1)}
        className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-ink shadow-sm transition-colors hover:text-cta disabled:opacity-40 lg:flex"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="mt-2 flex items-center justify-center gap-1.5">
        {blocks.map((block, dot) => (
          <button
            key={`${block.url}-dot-${dot}`}
            type="button"
            aria-label={`Go to detail image ${dot + 1}`}
            aria-current={dot === active}
            onClick={() => scrollToSlide(dot)}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              dot === active ? "bg-cta" : "bg-ink/25 hover:bg-ink/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
