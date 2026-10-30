// src/components/product/ProductGallery.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { ViewportVideo } from "./ViewportVideo";
import { optimizedUploadImage } from "@/lib/image-url";

interface Props {
  images: ProductImage[];
  active: number;
  onSelect: (index: number) => void;
  onOpenLightbox: (index: number) => void;
}

/** A tap that moved the track more than this is a swipe, not an open. */
const CLICK_SUPPRESS_PX = 8;
/** Wait for the momentum scroll to settle before reporting the new index. */
const SCROLL_SETTLE_MS = 100;

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

function GalleryVideo({ image }: { image: ProductImage }) {
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <ViewportVideo
        src={image.url}
        mode="TEASER"
        ariaLabel={image.altText ?? "Product video"}
        controls={false}
        onPlaybackChange={setPlaying}
        className="pointer-events-none aspect-square w-full object-cover"
      />
      {!playing && <PlayBadge />}
    </>
  );
}

function scrollTrackTo(track: HTMLDivElement, left: number) {
  if (typeof track.scrollTo === "function") {
    track.scrollTo({ left, behavior: "auto" });
    return;
  }
  track.scrollLeft = left;
}

/**
 * PDP_SPEC §6.3 + refinement: main media opens the lightbox. On phones the
 * media is a native scroll-snap carousel — the finger follows the image,
 * momentum carries it, and each frame fills the screen edge to edge with no
 * frame or gap. From sm up the carousel stays inside the content column.
 * Thumbnails mirror the same selection: with 1–5 entries all thumbnails are
 * shown directly (up to five); with 6+ the strip shows four direct thumbnails
 * followed by a "+N" tile (N = total − 4) that opens the lightbox at index 4.
 * Gallery entries can be photos or short videos — only the active video is
 * mounted, with a play badge until its inline preview starts playing.
 */
export function ProductGallery({ images, active, onSelect, onOpenLightbox }: Props) {
  const hasRealImages = images.length > 0 && images.some((image) => image.url);
  const directCount = images.length > 5 ? 4 : Math.min(5, images.length);
  const extra = images.length > 5 ? images.length - 4 : 0;

  const trackRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // A thumbnail tap (or a route/media-scope change) moves the carousel.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return;
    const target = active * track.clientWidth;
    if (Math.abs(track.scrollLeft - target) > 4) scrollTrackTo(track, target);
  }, [active, images.length]);

  useEffect(() => {
    const onResize = () => {
      const track = trackRef.current;
      if (!track || track.clientWidth <= 0) return;
      scrollTrackTo(track, activeRef.current * track.clientWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(
    () => () => {
      if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
    },
    [],
  );

  if (!hasRealImages) {
    return (
      <div className="-mx-4 overflow-hidden sm:mx-0">
        <PlaceholderImage label="" className="aspect-square w-full" />
      </div>
    );
  }

  const handleScroll = () => {
    if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track || track.clientWidth <= 0) return;
      const index = Math.max(
        0,
        Math.min(images.length - 1, Math.round(track.scrollLeft / track.clientWidth)),
      );
      if (index !== activeRef.current) onSelect(index);
    }, SCROLL_SETTLE_MS);
  };

  const handlePointerDown = () => {
    pointerStartRef.current = trackRef.current?.scrollLeft ?? null;
  };

  const handleSlideClick = (index: number) => {
    const track = trackRef.current;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (
      track &&
      start !== null &&
      Math.abs(track.scrollLeft - start) > CLICK_SUPPRESS_PX
    ) {
      return;
    }
    onOpenLightbox(index);
  };

  return (
    <div className="-mx-4 flex flex-col sm:mx-0">
      <div
        ref={trackRef}
        role="group"
        aria-label="Product media"
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            onClick={() => handleSlideClick(index)}
            aria-label={`Open media ${index + 1}`}
            aria-current={index === active ? "true" : undefined}
            className="relative w-full shrink-0 snap-center overflow-hidden"
          >
            {image.type === "VIDEO" ? (
              index === active ? (
                <GalleryVideo key={image.id} image={image} />
              ) : (
                <span className="relative flex aspect-square w-full items-center justify-center bg-black">
                  <PlayBadge />
                </span>
              )
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={optimizedUploadImage(image.url, 1280)}
                alt={image.altText ?? "Product image"}
                loading={index === 0 ? "eager" : "lazy"}
                className="aspect-square w-full object-cover"
              />
            )}
          </button>
        ))}
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:px-0">
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
                <img src={optimizedUploadImage(image.url, 96)} alt="" className="h-full w-full object-cover" />
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
                      src={optimizedUploadImage(preview.url, 96)}
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
