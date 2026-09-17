"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { HomepageSection, HydratedRoomScene } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { PriceBox } from "@/components/ui/PriceBox";
import { SectionPlaceholder } from "./SectionPlaceholder";

/**
 * Castlery-style shoppable room gallery: a full-width snap rail on every
 * breakpoint (desktop thumbnails scroll it), white hotspot dots that pop in
 * sequence once per scene, and a portaled product card linking to the PDP.
 */
const CARD_WIDTH = 240;
// Conservative upper bound for the flip-up math: a card whose struck-through
// price wraps measures ~125px tall, so 130 keeps the flipped card on screen.
const CARD_HEIGHT = 130;

interface OpenCard {
  sceneId: string;
  index: number;
}

export function RoomSceneGallery({
  section,
  scenes,
}: {
  section: Pick<HomepageSection, "id" | "title">;
  scenes: HydratedRoomScene[];
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [played, setPlayed] = useState<Set<string>>(() => new Set());
  const [reduced, setReduced] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // SSR = false, client = true: gates the createPortal call (house idiom,
  // shared with MainNav/SiteSearch; avoids set-state-in-effect).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

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
          const idx = scenes.filter((s) => !failed.has(s.id)).findIndex((s) => s.id === id);
          if (idx >= 0) setActive(idx);
        }
      },
      { root: rail, threshold: [0, 0.6] },
    );
    const els = rail.querySelectorAll<HTMLElement>("[data-scene-id]");
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [scenes, failed]);

  // Any scroll/resize dismisses the card: its fixed position is viewport-relative.
  // Capture phase on window also catches page scroll and inner containers —
  // scroll events themselves do not bubble.
  useEffect(() => {
    const close = () => setOpenCard(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  // Restore focus to the dot when the portaled card unmounts.
  const activatorRef = useRef<HTMLElement | null>(null);
  // Stable callback ref: focuses once when a card mounts (the Link is keyed
  // per scene/index, so opening a different dot detaches and reattaches).
  // preventScroll keeps the fixed card from moving the page behind it.
  const cardRef = useCallback((el: HTMLAnchorElement | null) => {
    el?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!openCard) {
      activatorRef.current?.focus();
      activatorRef.current = null;
    }
  }, [openCard]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openHotspot = useCallback((sceneId: string, index: number) => {
    const el = document.querySelector<HTMLElement>(`[data-hotspot="${sceneId}-${index}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - CARD_WIDTH / 2, 8),
      Math.max(8, window.innerWidth - CARD_WIDTH - 8),
    );
    const belowTop = rect.bottom + 8;
    const top = Math.max(
      8,
      belowTop + CARD_HEIGHT > window.innerHeight ? rect.top - 8 - CARD_HEIGHT : belowTop,
    );
    setCardPos({ top, left });
    activatorRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : el;
    setOpenCard({ sceneId, index });
  }, []);

  const visibleScenes = scenes.filter((s) => !failed.has(s.id));

  if (visibleScenes.length === 0) {
    return (
      <SectionPlaceholder
        title={section.title ?? ""}
        message="Room inspiration coming soon."
        inside
      />
    );
  }

  const openHotspotData = openCard
    ? visibleScenes
        .find((s) => s.id === openCard.sceneId)
        ?.hotspots[openCard.index]
    : undefined;

  return (
    <div>
      <div
        ref={railRef}
        className="flex snap-x snap-mandatory overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visibleScenes.map((scene) => (
          <div key={scene.id} data-scene-id={scene.id} className="w-full shrink-0 snap-center px-0.5">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-primary-light/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scene.imageUrl}
                alt={scene.alt ?? section.title ?? ""}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={() =>
                  setFailed((prev) => {
                    const next = new Set(prev);
                    next.add(scene.id);
                    return next;
                  })
                }
              />
              {scene.hotspots.map((hotspot, index) => {
                const isOpen =
                  openCard?.sceneId === scene.id && openCard.index === index;
                return (
                  <span
                    key={hotspot.product.id}
                    className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%` }}
                  >
                    <button
                      type="button"
                      data-hotspot={`${scene.id}-${index}`}
                      aria-expanded={isOpen}
                      aria-controls={`room-card-${scene.id}-${index}`}
                      aria-label={`查看商品：${hotspot.product.name}`}
                      onClick={() =>
                        isOpen
                          ? setOpenCard(null)
                          : openHotspot(scene.id, index)
                      }
                      className="relative h-7 w-7 transition-transform hover:scale-110"
                    >
                      {/* Animations stay mounted but paused until the scene
                          enters view: the 0% keyframe (opacity 0) hides the
                          dots pre-pop, so a slow scroll-in can't flash static
                          dots before the staggered sequence starts. */}
                      {!reduced ? (
                        <span
                          className="hotspot-ring pointer-events-none absolute inset-0 rounded-full border border-cta/50"
                          style={{
                            animationDelay: `${index * 90 + 120}ms`,
                            animationPlayState: played.has(scene.id) ? "running" : "paused",
                          }}
                        />
                      ) : null}
                      {/* Inner layer owns the pop animation AND the disc shell
                          so the whole dot lights up together; its fill-mode
                          transform never overrides the button's hover scale. */}
                      <span
                        className={`inline-flex h-full w-full items-center justify-center rounded-full bg-white/95 shadow-md ${
                          isOpen ? "ring-2 ring-cta" : "ring-1 ring-border"
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
                        <span className="h-2 w-2 rounded-full bg-cta" />
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
        <div className="mt-3 hidden justify-center gap-2 lg:flex">
          {visibleScenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              aria-label={`查看第 ${index + 1} 张场景图`}
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
                src={scene.imageUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={() =>
                  setFailed((prev) => {
                    const next = new Set(prev);
                    next.add(scene.id);
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
        <div className="mt-3 flex justify-center gap-1.5 lg:hidden" aria-hidden>
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

      {/* Portaled product card (fixed positioning escapes rail overflow) */}
      {mounted && openCard && openHotspotData
        ? createPortal(
            <>
              <button
                type="button"
                tabIndex={-1}
                aria-label="关闭商品卡"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setOpenCard(null)}
              />
              <Link
                key={`${openCard.sceneId}-${openCard.index}`}
                href={`/products/${openHotspotData.product.slug}`}
                id={`room-card-${openCard.sceneId}-${openCard.index}`}
                ref={cardRef}
                {...trackAttrs("ProductClick", section, openCard.index + 1)}
                onClick={() => setOpenCard(null)}
                className="fixed z-50 flex w-60 gap-3 rounded-xl border border-border bg-card p-3 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-cta"
                style={{ top: cardPos.top, left: cardPos.left }}
              >
                <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-primary-light/30">
                  {openHotspotData.product.images[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={openHotspotData.product.images[0].url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <PlaceholderImage label="" className="h-full w-full" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-sm font-medium text-ink">
                    {openHotspotData.product.name}
                  </span>
                  <PriceBox
                    price={openHotspotData.product.variants[0]?.sku?.price ?? null}
                    compareAtPrice={
                      openHotspotData.product.variants[0]?.sku?.compareAtPrice ?? null
                    }
                  />
                </span>
                <span aria-hidden className="self-center text-lg text-cta">
                  ›
                </span>
              </Link>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
