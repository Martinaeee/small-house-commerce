import type { Room, Solution } from "./api";
import {
  DEFAULT_FILTERS,
  PRICE_BAND_OPTIONS,
  ROOM_OPTIONS,
  SOLUTION_OPTIONS,
  SORT_OPTIONS,
  type PlpFilters,
  type PriceBand,
  type SortKey,
} from "./plp";

/**
 * URL <-> PLP state (spec §4.2 P3). The URL is the single source of truth:
 * ?sort=&room=&solutions=A,B&price=&instock=1. Unknown/illegal values fall
 * back to defaults so hand-edited links never break the page.
 */
const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((o) => o.value));
const ROOM_VALUES = new Set<string>(ROOM_OPTIONS.map((o) => o.value));
const SOLUTION_VALUES = new Set<string>(SOLUTION_OPTIONS.map((o) => o.value));
const PRICE_VALUES = new Set<string>(PRICE_BAND_OPTIONS.map((o) => o.value));

export function parsePlpState(search: {
  get(name: string): string | null;
}): { sort: SortKey; filters: PlpFilters } {
  const sortRaw = search.get("sort");
  const sort: SortKey =
    sortRaw && SORT_VALUES.has(sortRaw) ? (sortRaw as SortKey) : "recommended";

  const roomRaw = search.get("room");
  const room: Room | null =
    roomRaw && ROOM_VALUES.has(roomRaw) ? (roomRaw as Room) : null;

  const solutions: Solution[] = [];
  const solutionsRaw = search.get("solutions");
  if (solutionsRaw) {
    for (const value of solutionsRaw.split(",")) {
      const trimmed = value.trim();
      if (SOLUTION_VALUES.has(trimmed) && !solutions.includes(trimmed as Solution)) {
        solutions.push(trimmed as Solution);
      }
    }
  }

  const priceRaw = search.get("price");
  const priceBand: PriceBand | null =
    priceRaw && PRICE_VALUES.has(priceRaw) ? (priceRaw as PriceBand) : null;

  return {
    sort,
    filters: { ...DEFAULT_FILTERS, room, solutions, priceBand, inStockOnly: search.get("instock") === "1" },
  };
}

/** Serializes only non-default state; returns "" for the canonical clean URL. */
export function buildPlpQuery(sort: SortKey, filters: PlpFilters): string {
  const q = new URLSearchParams();
  if (sort !== "recommended") q.set("sort", sort);
  if (filters.room) q.set("room", filters.room);
  if (filters.solutions.length > 0) q.set("solutions", filters.solutions.join(","));
  if (filters.priceBand) q.set("price", filters.priceBand);
  if (filters.inStockOnly) q.set("instock", "1");
  return q.toString();
}
