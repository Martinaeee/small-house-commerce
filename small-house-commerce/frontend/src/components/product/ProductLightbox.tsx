// src/components/product/ProductLightbox.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductImage } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

interface Props {
  images: ProductImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ProductLightbox({ images, index, onClose, onNavigate }: Props) {
  const touchX = useRef<number | null>(null);
  const [animating, setAnimating] = useState(false);

  const go = useCallback(
    (next: number) => {
      const clamped = (next + images.length) % images.length;
      if (clamped === index) return;
      setAnimating(true);
      onNavigate(clamped);
    },
    [images.length, onNavigate, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [index, go, onClose]);

  useEffect(() => {
    const t = setTimeout(() => setAnimating(false), 150);
    return () => clearTimeout(t);
  }, [index]);

  const current = images[index];

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Product image viewer"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const delta = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(delta) > 40) go(delta < 0 ? index + 1 : index - 1);
        touchX.current = null;
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
      >
        ✕
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={() => go(index - 1)}
            className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={() => go(index + 1)}
            className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
          >
            ›
          </button>
        </>
      )}

      <div className="flex flex-1 items-center justify-center p-4 sm:p-10">
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
          <PlaceholderImage label="" className="aspect-square w-full max-w-xl rounded-md" />
        )}
      </div>

      <div className="pb-6 text-center text-sm font-medium text-white/80">
        {index + 1} / {images.length}
      </div>
    </div>
  );
}
