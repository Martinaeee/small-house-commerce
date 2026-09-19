// src/components/product/ProductLightbox.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

interface Props {
  images: ProductImage[];
  /** Product display name — shown in the desktop thumbnail rail header. */
  productName?: string;
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

type ViewMode = "split" | "column";

/**
 * PDP_REFINEMENT §6.3 lightbox, upgraded to an Amazon-style gallery:
 *
 * Desktop (≥1024px): white split view. Large stage image on the left, and on
 * the right a fixed rail with the product name above a vertical thumbnail
 * column. Clicking a thumbnail swaps the stage image; the active rail tile is
 * highlighted. Keyboard ←/→ move through images.
 *
 * Mobile (<1024px): white vertical "connected" gallery. Every photo is
 * stacked in order and the overlay scrolls through them as one continuous
 * band; it opens scrolled to the exact image that was clicked (a double rAF
 * after the overlay mounts keeps the anchor clean even as lazy images size
 * in). Tap ✕ / backdrop to close, body scroll locked while open. The old
 * horizontal-swipe arrows are gone — the vertical scroll flow replaces them.
 */
export function ProductLightbox({ images, productName, index, onClose, onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Pick the layout from the viewport once. The overlay is client-only and
  // does not respond to live resize — resizing just shows what a re-open
  // would (PDP spec: the two layouts are distinct per breakpoint).
  const [mode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
      ? "split"
      : "column",
  );
  const [animating, setAnimating] = useState(false);
  // Mobile counter follows the band: which image is most visible right now.
  // Starts at the opened index; scroll updates it (desktop counter is the
  // staged index and stays a prop, not this).
  const [visibleIndex, setVisibleIndex] = useState(index);

  // Render-time adjustment, same pattern as PdpClient's variant sync: when
  // the staged index moves in split mode, mark the stage as fading so the
  // next committed render hides the old photo; a 150ms timer restores it.
  const [prevStageIndex, setPrevStageIndex] = useState(index);
  if (mode === "split" && index !== prevStageIndex) {
    setPrevStageIndex(index);
    setAnimating(true);
  }

  // Body scroll lock + Esc / desktop arrow-key handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (mode !== "split") return;
      if (e.key === "ArrowRight") onNavigate((index + 1) % images.length);
      if (e.key === "ArrowLeft") onNavigate((index - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [index, mode, images.length, onClose, onNavigate]);

  const current = images[index];

  // Turn off the stage fade shortly after it was turned on by the render-time
  // adjustment above (which only fires in split mode, so running the timer
  // unconditionally is harmless).
  useEffect(() => {
    const t = setTimeout(() => setAnimating(false), 150);
    return () => clearTimeout(t);
  }, [index]);

  // Column mode: scroll the clicked image into view after the overlay mounts
  // and every time the index moves (the keyboard/arrows are desktop-only, but
  // Pinch/zoom-free navigation or future hooks can still drive this).
  const scrollToIndex = useCallback(
    (target: number) => {
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[data-image-index="${target}"]`,
      );
      if (el) el.scrollIntoView({ block: "start" });
    },
    [scrollRef],
  );
  useEffect(() => {
    if (mode !== "column") return;
    // Double rAF: first after the DOM slot renders, second after lazy images
    // have had a chance to resize their containers — otherwise scrollIntoView
    // can land mid-band and drift.
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToIndex(index));
    });
    return () => cancelAnimationFrame(raf1);
  }, [index, mode, scrollToIndex]);

  // Column mode: keep the counter in step with the most-visible photo while
  // the user scrolls the band. Root margin biases to the center band so the
  // "current" image flips near the middle of the screen, not the edge.
  useEffect(() => {
    if (mode !== "column") return;
    const root = scrollRef.current;
    if (!root) return;
    const items =
      Array.from(
        root.querySelectorAll<HTMLElement>("[data-image-index]"),
      ) ?? [];
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleIndex(Number(entry.target.getAttribute("data-image-index")));
          }
        }
      },
      { root, rootMargin: "-40% 0px -40% 0px", threshold: 0 },
    );
    items.forEach((el) => observer.observe(el));
    setVisibleIndex(index);
    return () => observer.disconnect();
  }, [mode, index, scrollRef]);

  const onThumb = useCallback(
    (i: number) => {
      if (i !== index) onNavigate(i);
    },
    [index, onNavigate],
  );

  const showArrows = mode === "split" && images.length > 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-card text-ink"
      role="dialog"
      aria-modal="true"
      aria-label="Product image gallery"
    >
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image gallery"
        className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-border text-xl text-ink hover:bg-primary-light/40"
      >
        ✕
      </button>

      {mode === "split" ? (
        /* ---- Desktop split view: stage left, title + rail right ---- */
        <div className="flex h-full min-h-0">
          <div className="relative flex flex-1 min-h-0 items-center justify-center p-6 lg:p-12">
            {showArrows && (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() => onThumb((index - 1 + images.length) % images.length)}
                  className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border text-2xl text-ink shadow-sm hover:bg-primary-light/40"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={() => onThumb((index + 1) % images.length)}
                  className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border text-2xl text-ink shadow-sm hover:bg-primary-light/40"
                >
                  ›
                </button>
              </>
            )}
            {current.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={current.id}
                src={current.url}
                alt={current.altText ?? "Product image"}
                className={`max-h-full max-w-full rounded-md object-contain transition-opacity duration-150 ${
                  animating ? "opacity-0" : "opacity-100"
                }`}
              />
            ) : (
              <PlaceholderImage label="" className="aspect-square w-full max-w-2xl rounded-md" />
            )}
          </div>

          {/* Right rail: sticky product name + vertical thumbnail column */}
          <div className="flex w-[300px] shrink-0 flex-col border-l border-border bg-background/60">
            <div className="border-b border-border px-4 py-4">
              <p className="line-clamp-2 text-sm font-semibold text-ink">{productName}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {images.map((image, i) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => onThumb(i)}
                  aria-label={`View image ${i + 1}`}
                  aria-current={i === index}
                  className={`mb-3 block w-full overflow-hidden rounded-lg border-2 transition-colors ${
                    i === index ? "border-cta" : "border-transparent hover:border-primary"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt=""
                    className="aspect-square w-full object-cover"
                  />
                </button>
              ))}
            </div>
            <div className="border-t border-border px-4 py-3 text-center">
              <span className="text-sm font-medium text-ink-secondary">
                {index + 1} / {images.length}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ---- Mobile column: stacked photos in one continuous band ---- */
        <div ref={scrollRef} className="h-full min-h-0 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-2xl">
            {images.map((image, i) => (
              <div
                key={image.id}
                data-image-index={i}
                className="relative flex min-h-[70dvh] items-center justify-center px-3 py-2"
              >
                {image.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image.url}
                    alt={image.altText ?? `Product image ${i + 1}`}
                    className="max-h-[85dvh] w-full object-contain"
                  />
                ) : (
                  <PlaceholderImage label="" className="aspect-square w-full max-w-md rounded-md" />
                )}
              </div>
            ))}
            <div className="sticky bottom-3 -mt-12 mb-3 flex justify-center">
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                {visibleIndex + 1} / {images.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}