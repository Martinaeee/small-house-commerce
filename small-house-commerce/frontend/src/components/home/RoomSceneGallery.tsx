"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { HomepageSection, HydratedRoomScene } from "@/lib/api";
import type { SectionPreviewDevice } from "./sectionRegistry";
import { trackAttrs } from "@/lib/home-tracking";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";
import { RatingStars } from "@/components/product/RatingStars";
import { cardPricePresentation } from "@/lib/product-card-presentation";
import {
  createInitialSelection,
  resolveSelection,
} from "@/lib/product-selection";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { optimizedUploadImage } from "@/lib/image-url";

/**
 * Castlery-style shoppable room gallery: a full-width snap rail on every
 * breakpoint (desktop thumbnails scroll it), numbered hotspot markers that
 * pop in sequence once per scene, and the scene's products listed beside the
 * photo - a horizontal rail on a phone, a column on a desktop. The number on
 * a marker and the number on the product card are the same product, and
 * tapping a marker scrolls the list to that card.
 */
function sceneFailureKey(scene: Pick<HydratedRoomScene, "id" | "imageUrl">): string {
  return `${scene.id}\u0000${scene.imageUrl}`;
}

interface ActiveHotspot {
  sceneId: string;
  index: number;
}

export function RoomSceneGallery({
  section,
  scenes,
  previewDevice,
}: {
  section: Pick<HomepageSection, "id" | "title">;
  scenes: HydratedRoomScene[];
  previewDevice?: SectionPreviewDevice;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [played, setPlayed] = useState<Set<string>>(() => new Set());
  const [reduced, setReduced] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [activeHotspot, setActiveHotspot] = useState<ActiveHotspot | null>(null);
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({});

  // Reduced motion: skip the observer-driven pop sequence entirely and show
  // every dot statically.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduced(mq.matches);
      if (mq.matches) setPlayed(new Set(scenes.map((s) => s.id)));
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [scenes]);

  // Track the in-view scene for thumbnails / indicator dots, and fire each
  // scene's pop sequence once on its first positive intersection (the 60%
  // ratio only decides thumbnail/indicator highlighting). Runs even under
  // reduced motion (only the animation class is gated by !reduced). The
  // active index is computed over the post-onError visible list so a failed
  // early image cannot shift the highlight; resubscribing on `failed` is safe
  // because the played Set guarantees no scene replays its pop sequence.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.sceneId;
          if (!id) continue;
          // Arm on ANY positive intersection: in wide-and-short windows the
          // slide may never reach 60% of the rail, and gating visibility on
          // that ratio would leave the dots paused at opacity 0 forever.
          setPlayed((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
          });
          // The 0.6 threshold alone drives thumbnail/indicator highlighting.
          if (entry.intersectionRatio < 0.6) continue;
          const idx = scenes
            .filter((scene) => !failed.has(sceneFailureKey(scene)))
            .findIndex((scene) => scene.id === id);
          if (idx >= 0) setActive(idx);
        }
      },
      { root: rail, threshold: [0, 0.6] },
    );
    const els = rail.querySelectorAll<HTMLElement>("[data-scene-id]");
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [scenes, failed]);

  // Tapping a marker moves the product list to the matching card. The list
  // is a horizontal rail on a phone and a column beside the photo on a
  // desktop, so scrollIntoView handles both axes: it scrolls the rail
  // sideways and brings the card into the viewport.
  useEffect(() => {
    if (!activeHotspot) return;
    const card = document.querySelector<HTMLElement>(
      `[data-room-product-card="${activeHotspot.sceneId}-${activeHotspot.index}"]`,
    );
    card?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeHotspot, reduced]);

  const visibleScenes = scenes.filter(
    (scene) => !failed.has(sceneFailureKey(scene)),
  );
  const thumbnailClass = previewDevice
    ? previewDevice === "desktop"
      ? "mt-3 flex justify-center gap-2"
      : "hidden"
    : "mt-3 hidden justify-center gap-2 lg:flex";
  const indicatorClass = previewDevice
    ? previewDevice === "desktop"
      ? "hidden"
      : "mt-3 flex justify-center gap-1.5"
    : "mt-3 flex justify-center gap-1.5 lg:hidden";
  // The marker is sized for the device it is drawn on: the admin canvas
  // passes the device it simulates, the storefront follows its own
  // breakpoints (24px phone, 28px tablet, 32px desktop). The number scales
  // with it so it stays legible inside the disc.
  const markerSize = previewDevice
    ? previewDevice === "mobile"
      ? "h-6 w-6"
      : previewDevice === "tablet"
        ? "h-7 w-7"
        : "h-8 w-8"
    : "h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8";
  const markerNumberSize = previewDevice
    ? previewDevice === "mobile"
      ? "text-[11px]"
      : previewDevice === "tablet"
        ? "text-xs"
        : "text-[13px]"
    : "text-[11px] sm:text-xs lg:text-[13px]";

  if (visibleScenes.length === 0) {
    return (
      <SectionPlaceholder
        title={section.title ?? ""}
        message="Room inspiration coming soon."
        inside
      />
    );
  }

  const listedScene = visibleScenes[active] ?? visibleScenes[0];

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
      <div className="min-w-0 flex-1">
        <div
          ref={railRef}
          className="flex snap-x snap-mandatory overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleScenes.map((scene) => (
            <div key={scene.id} data-scene-id={scene.id} className="w-full shrink-0 snap-center px-0.5">
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-primary-light/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={optimizedUploadImage(scene.imageUrl, 1440)}
                  alt={scene.alt ?? section.title ?? ""}
                  loading="lazy"
                  className="h-full w-full object-contain"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (image.naturalWidth && image.naturalHeight) {
                      const ratio = image.naturalWidth / image.naturalHeight;
                      const key = sceneFailureKey(scene);
                      setImageRatios((previous) => previous[key] === ratio ? previous : { ...previous, [key]: ratio });
                    }
                  }}
                  onError={() =>
                    setFailed((prev) => {
                      const next = new Set(prev);
                      next.add(sceneFailureKey(scene));
                      return next;
                    })
                  }
                />
                {scene.hotspots.map((hotspot, index) => {
                  const isActive =
                    activeHotspot?.sceneId === scene.id && activeHotspot.index === index;
                  const ratio = imageRatios[sceneFailureKey(scene)] ?? 1.6;
                  const imageWidth = Math.min(1, ratio / 1.6) * 100;
                  const imageHeight = Math.min(1, 1.6 / ratio) * 100;
                  const position = { left: `${(100 - imageWidth) / 2 + hotspot.xPct * imageWidth / 100}%`,
                    top: `${(100 - imageHeight) / 2 + hotspot.yPct * imageHeight / 100}%` };
                  return (
                    <span
                      key={hotspot.product.id}
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                      style={position}
                    >
                      <button
                        type="button"
                        data-hotspot={`${scene.id}-${index}`}
                        data-active={isActive ? "true" : "false"}
                        aria-label={`View product: ${hotspot.product.name}`}
                        onClick={() => {
                          // Show the clicked scene's products, then scroll the
                          // list to the matching card.
                          const sceneIndex = visibleScenes.findIndex(
                            (candidate) => candidate.id === scene.id,
                          );
                          if (sceneIndex >= 0) setActive(sceneIndex);
                          setActiveHotspot({ sceneId: scene.id, index });
                        }}
                        className={`relative ${markerSize} rounded-full transition-transform duration-200 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2`}
                      >
                        {/* Animations stay mounted but paused until the scene
                            enters view: the 0% keyframe (opacity 0) hides the
                            halo pre-pop, so a slow scroll-in can't flash static
                            markers before the staggered sequence starts. */}
                        {!reduced ? (
                          <span
                            className="hotspot-ring pointer-events-none absolute inset-0 rounded-full bg-white/70"
                            style={{
                              animationDelay: `${index * 90 + 120}ms`,
                              animationPlayState: played.has(scene.id) ? "running" : "paused",
                            }}
                          />
                        ) : null}
                        {/* A quiet white disc with a hairline edge and the
                            product's number - the marker and the product card
                            carry the same number, so the photo and the list
                            read as the same list. */}
                        <span
                          data-hotspot-disc
                          className={`relative inline-flex h-full w-full items-center justify-center rounded-full shadow-[0_2px_10px_rgba(34,34,34,0.22)] transition-colors ${
                            isActive ? "bg-cta" : "bg-white/95 ring-1 ring-black/10"
                          } ${!reduced ? "hotspot-pop" : ""}`}
                          style={
                            !reduced
                              ? {
                                  animationDelay: `${index * 90}ms`,
                                  animationPlayState: played.has(scene.id) ? "running" : "paused",
                                }
                              : undefined
                          }
                        >
                          <span
                            data-hotspot-number
                            className={`${markerNumberSize} font-semibold leading-none ${
                              isActive ? "text-cta-foreground" : "text-cta"
                            }`}
                          >
                            {index + 1}
                          </span>
                        </span>
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop thumbnail selector */}
        {visibleScenes.length > 1 ? (
          <div className={thumbnailClass}>
            {visibleScenes.map((scene, index) => (
              <button
                key={scene.id}
                type="button"
                aria-label={`View scene ${index + 1}`}
                onClick={() => {
                  railRef.current
                    ?.querySelector(`[data-scene-id="${scene.id}"]`)
                    ?.scrollIntoView({
                      behavior: reduced ? "auto" : "smooth",
                      inline: "center",
                      block: "nearest",
                    });
                }}
                className={`relative h-16 w-28 overflow-hidden rounded-lg ring-offset-2 ${
                  active === index ? "ring-2 ring-cta" : "ring-1 ring-border"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={optimizedUploadImage(scene.imageUrl, 1440)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={() =>
                    setFailed((prev) => {
                      const next = new Set(prev);
                      next.add(sceneFailureKey(scene));
                      return next;
                    })
                  }
                />
              </button>
            ))}
          </div>
        ) : null}

        {/* Mobile indicator dots */}
        {visibleScenes.length > 1 ? (
          <div className={indicatorClass} aria-hidden>
            {visibleScenes.map((scene, index) => (
              <span
                key={scene.id}
                className={`h-2 rounded-full transition-all ${
                  active === index ? "w-4 bg-cta" : "w-2 bg-border"
                }`}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* The products of the scene in view: beside the photo on desktop,
          a swipeable rail under it on smaller screens. */}
      <RoomProductList
        section={section}
        scene={listedScene}
        activeIndex={
          activeHotspot && activeHotspot.sceneId === listedScene?.id
            ? activeHotspot.index
            : null
        }
      />
    </div>
  );
}

/**
 * The products of the scene in view, listed beside the photo on desktop and
 * as a horizontal rail under it on smaller screens: thumbnail, single-line
 * name, the real price, the real rating and a link to the product page. The
 * price comes from the same selection contract the product cards use, and the
 * rating only appears when the product actually has reviews. Each card
 * carries the same number as the hotspot marker that points at it.
 */
export function RoomProductList({
  section,
  scene,
  activeIndex,
}: {
  section: Pick<HomepageSection, "id" | "title">;
  scene: HydratedRoomScene | undefined;
  activeIndex: number | null;
}) {
  if (!scene || scene.hotspots.length === 0) return null;
  return (
    <aside
      data-room-product-list
      className="w-full shrink-0 lg:w-[300px] xl:w-[340px]"
    >
      <h3 className="mb-2 text-sm font-semibold text-ink">Shop this room</h3>
      <ul
        data-room-product-rail
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:snap-none lg:flex-col lg:gap-1 lg:overflow-x-visible"
      >
        {scene.hotspots.map((hotspot, index) => {
          const product = hotspot.product;
          const cover = product.effectiveCoverMedia ?? null;
          // The storefront hydrates a full product; a partial one (admin
          // payloads) still renders, it just carries no price.
          const price = Array.isArray(product.variants)
            ? cardPricePresentation(
                resolveSelection(
                  product,
                  createInitialSelection(product, null),
                ),
              )
            : null;
          const rating =
            product.ratingAverage != null && product.reviewCount > 0
              ? { value: product.ratingAverage, count: product.reviewCount }
              : null;
          const isActive = activeIndex === index;
          return (
            <li
              key={product.id}
              data-room-product-row={product.id}
              data-room-product-card={`${scene.id}-${index}`}
              data-active={isActive ? "true" : "false"}
              className="w-[220px] shrink-0 snap-start lg:w-auto lg:shrink"
            >
              <Link
                href={`/products/${product.slug}`}
                {...trackAttrs("ProductClick", section, index + 1)}
                aria-current={isActive ? "true" : undefined}
                className={`flex items-start gap-3 rounded-lg p-2 transition-colors ${
                  isActive
                    ? "bg-primary-light/40 ring-1 ring-cta"
                    : "hover:bg-primary-light/30"
                }`}
              >
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-primary-light/30">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={optimizedUploadImage(cover.url, 96)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlaceholderImage label="" className="h-full w-full" />
                  )}
                  {/* The same number the marker on the photo carries. */}
                  <span
                    data-room-product-number
                    className={`absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold leading-none shadow-[0_1px_4px_rgba(34,34,34,0.25)] ${
                      isActive ? "bg-cta text-cta-foreground" : "bg-white/95 text-cta"
                    }`}
                  >
                    {index + 1}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {product.name}
                  </span>
                  {rating ? (
                    <span className="mt-0.5 flex items-center gap-1">
                      <RatingStars
                        value={rating.value}
                        className="text-[11px] leading-none"
                      />
                      <span className="text-[11px] text-ink-muted">
                        ({rating.count})
                      </span>
                    </span>
                  ) : null}
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                    {price ? (
                      <>
                        <span className="whitespace-nowrap text-[16px] font-bold leading-tight text-sale">
                          {price.kind === "from"
                            ? `From ${formatPrice(price.price)}`
                            : formatPrice(price.price)}
                        </span>
                        {price.kind === "exact" &&
                        price.compareAtPrice != null &&
                        price.compareAtPrice > price.price ? (
                          <span className="whitespace-nowrap text-xs leading-tight text-ink-muted line-through">
                            {formatPrice(price.compareAtPrice)}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                    <span className="ml-auto whitespace-nowrap text-xs font-medium text-cta">
                      View product
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
