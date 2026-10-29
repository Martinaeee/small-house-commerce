"use client";

import { useState } from "react";
import type { HomepageSection, HydratedRoomScene } from "@/lib/api";
import { RoomProductList } from "./RoomSceneGallery";
import { optimizedUploadImage } from "@/lib/image-url";

/**
 * The room scenes stacked vertically on their own page: every scene gets the
 * full width, its numbered hotspot markers and its own product list, so the
 * three scenes read top to bottom instead of as one swipeable rail.
 */
export function RoomSceneStack({
  section,
  scenes,
}: {
  section: Pick<HomepageSection, "id" | "title">;
  scenes: HydratedRoomScene[];
}) {
  const [active, setActive] = useState<{ sceneId: string; index: number } | null>(
    null,
  );
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  const visible = scenes.filter(
    (scene) => !failed.has(`${scene.id}\u0000${scene.imageUrl}`),
  );

  return (
    <div className="flex flex-col gap-12 lg:gap-16">
      {visible.map((scene, sceneIndex) => {
        const key = `${scene.id}\u0000${scene.imageUrl}`;
        const ratio = ratios[key] ?? 1.6;
        // The photo is letter-boxed inside the frame, so a marker has to be
        // placed against the image's own box, not the frame's.
        const imageWidth = Math.min(1, ratio / 1.6) * 100;
        const imageHeight = Math.min(1, 1.6 / ratio) * 100;
        return (
          <section
            key={scene.id}
            data-room-scene={scene.id}
            className="flex min-w-0 flex-col gap-4"
          >
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-primary-light/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={optimizedUploadImage(scene.imageUrl, 1440)}
                alt={scene.alt ?? section.title ?? ""}
                loading="lazy"
                className="h-full w-full object-contain"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (!image.naturalWidth || !image.naturalHeight) return;
                  const next = image.naturalWidth / image.naturalHeight;
                  setRatios((previous) =>
                    previous[key] === next ? previous : { ...previous, [key]: next },
                  );
                }}
                onError={() =>
                  setFailed((previous) => {
                    const next = new Set(previous);
                    next.add(key);
                    return next;
                  })
                }
              />
              {scene.hotspots.map((hotspot, index) => {
                const isActive =
                  active?.sceneId === scene.id && active.index === index;
                const position = {
                  left: `${(100 - imageWidth) / 2 + (hotspot.xPct * imageWidth) / 100}%`,
                  top: `${(100 - imageHeight) / 2 + (hotspot.yPct * imageHeight) / 100}%`,
                };
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
                      onClick={() => setActive({ sceneId: scene.id, index })}
                      className="relative h-6 w-6 rounded-full transition-transform duration-200 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 sm:h-7 sm:w-7 lg:h-8 lg:w-8"
                    >
                      <span
                        data-hotspot-disc
                        className={`relative inline-flex h-full w-full items-center justify-center rounded-full shadow-[0_2px_10px_rgba(34,34,34,0.22)] transition-colors ${
                          isActive ? "bg-cta" : "bg-white/95 ring-1 ring-black/10"
                        }`}
                      >
                        <span
                          data-hotspot-number
                          className={`text-[11px] font-semibold leading-none sm:text-xs lg:text-[13px] ${
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
            <RoomProductList
              section={section}
              scene={scene}
              activeIndex={
                active && active.sceneId === scene.id ? active.index : null
              }
            />
            <span className="sr-only">Scene {sceneIndex + 1}</span>
          </section>
        );
      })}
    </div>
  );
}
