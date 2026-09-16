import type { HydratedRoomScene, Product } from "@/lib/api";

const num0to100 = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.slug === "string" &&
    typeof p.name === "string" &&
    Array.isArray(p.images) &&
    Array.isArray(p.variants)
  );
}

/**
 * Narrow the storefront ROOM_INSPIRATION payload to hydrated scenes.
 * Returns null when there is no valid gallery (caller renders legacy view).
 * Scenes survive with zero valid hotspots (plain editorial image is fine);
 * scenes missing id/image or with malformed dots are dropped individually.
 */
export function parseScenes(payload: Record<string, unknown>): HydratedRoomScene[] | null {
  if (!Array.isArray(payload.scenes)) return null;

  const scenes: HydratedRoomScene[] = [];
  for (const raw of payload.scenes) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.imageUrl !== "string") continue;

    const rawHotspots = Array.isArray(rec.hotspots) ? rec.hotspots : [];
    const hotspots = rawHotspots.flatMap((dot) => {
      if (!dot || typeof dot !== "object") return [];
      const d = dot as Record<string, unknown>;
      const xPct = num0to100(d.xPct);
      const yPct = num0to100(d.yPct);
      if (!isProduct(d.product) || xPct === null || yPct === null) return [];
      return [{ productId: d.product.id, xPct, yPct, product: d.product }];
    });

    scenes.push({
      id: rec.id,
      imageUrl: rec.imageUrl,
      ...(typeof rec.alt === "string" && rec.alt ? { alt: rec.alt } : {}),
      hotspots,
    });
  }

  return scenes.length > 0 ? scenes : null;
}
