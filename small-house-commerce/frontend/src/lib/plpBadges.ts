/**
 * Unified merchandise badges driven entirely by collection membership
 * (spec §4.3). A product can carry one promo badge (collection.badgeLabel)
 * plus at most one identity badge (best-sellers / new-arrivals). Discount is
 * never shown here — strikethrough pricing in PriceBox carries that alone.
 */
export type BadgeKind = "bestseller" | "new" | "promo";

export interface CardBadge {
  kind: BadgeKind;
  label: string;
}

export const BESTSELLER_BADGE: CardBadge = { kind: "bestseller", label: "Best Seller" };
export const NEW_BADGE: CardBadge = { kind: "new", label: "New" };

const KIND_PRIORITY: Record<BadgeKind, number> = { promo: 0, bestseller: 1, new: 2 };

/** Flatten "collection -> member slugs" into product-slug -> badges. */
export function buildBadgeMap(
  entries: { slug: string; badge: CardBadge }[],
): Map<string, CardBadge[]> {
  const map = new Map<string, CardBadge[]>();
  for (const { slug, badge } of entries) {
    const list = map.get(slug) ?? [];
    if (!list.some((existing) => existing.kind === badge.kind)) list.push(badge);
    map.set(slug, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  }
  return map;
}

/**
 * At most two chips, promo first. Without a promo the product gets a single
 * identity chip (bestseller wins over new), preserving the prior look.
 */
export function visibleBadges(
  map: ReadonlyMap<string, readonly CardBadge[]>,
  slug: string,
): CardBadge[] {
  const all = map.get(slug);
  if (!all || all.length === 0) return [];
  const promo = all.find((badge) => badge.kind === "promo");
  const identity =
    all.find((badge) => badge.kind === "bestseller") ??
    all.find((badge) => badge.kind === "new");
  if (promo && identity) return [promo, identity];
  if (promo) return [promo];
  return identity ? [identity] : [];
}
