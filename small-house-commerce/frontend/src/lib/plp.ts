import type { Product, Room, Solution } from "@/lib/api";
import { cardPricePresentation, type CardPricePresentation } from "./product-card-presentation";
import { createInitialSelection, resolveSelection } from "./product-selection";

/**
 * Pure client-side PLP logic for category pages. The storefront product API
 * is frozen and exposes no sort parameter (fixed newest-first), so the
 * category page fetches the whole category and sorts/filters it here.
 */

/** Largest page the storefront API allows; the PLP server-renders page 1. */
export const PLP_PAGE_SIZE = 48;

/** Safety cap for client-side fetch-all (5 pages). Catalogs stay well under. */
export const PLP_MAX_PRODUCTS = 240;

export type SortKey = "recommended" | "fast-dispatch" | "price-asc" | "price-desc";

export type PriceBand = "0-1000" | "1000-3000" | "3000-";

export interface PlpFilters {
  room: Room | null;
  solutions: Solution[];
  priceBand: PriceBand | null;
  inStockOnly: boolean;
}

export const DEFAULT_FILTERS: PlpFilters = {
  room: null,
  solutions: [],
  priceBand: null,
  inStockOnly: false,
};

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recommended", label: "Recommendation" },
  { value: "fast-dispatch", label: "Fast Dispatch" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
];

export const ROOM_OPTIONS: { value: Room; label: string }[] = [
  { value: "BEDROOM", label: "Bedroom" },
  { value: "STORAGE", label: "Storage" },
  { value: "DINING_LIVING", label: "Dining & Living" },
  { value: "HOME_OFFICE", label: "Home Office" },
];

export const SOLUTION_OPTIONS: { value: Solution; label: string }[] = [
  { value: "FOLDABLE", label: "Foldable" },
  { value: "NARROW_SPACE", label: "Narrow Space" },
  { value: "MOBILE", label: "Mobile" },
  { value: "MULTIFUNCTIONAL", label: "Multi-purpose" },
  { value: "HIDDEN_STORAGE", label: "Hidden Storage" },
  { value: "RENTAL_FRIENDLY", label: "Rental Friendly" },
];

export const PRICE_BAND_OPTIONS: { value: PriceBand; label: string }[] = [
  { value: "0-1000", label: "Under ₱1,000" },
  { value: "1000-3000", label: "₱1,000 – ₱3,000" },
  { value: "3000-", label: "Above ₱3,000" },
];

/**
 * Price presentation derived from the shared selection contract — never a
 * positional SKU pick (Task 20 sweep of the former `representativeSku`):
 * the exact price when a single sellable SKU auto-resolves (or every sellable
 * SKU shares one price), otherwise the lowest sellable price as the "from"
 * floor. See product-card-presentation.ts for the full contract.
 */
export function productCardPrice(product: Product): CardPricePresentation | null {
  return cardPricePresentation(
    resolveSelection(product, createInitialSelection(product, null)),
  );
}

/**
 * In stock when ANY sellable SKU has inventory — never "the first SKU in API
 * order happens to be in stock". Filters and structured-data availability
 * must reflect whether the visitor can actually buy something.
 */
export function isInStock(product: Product): boolean {
  return resolveSelection(product, createInitialSelection(product, null)).selectableVariants.some(
    (variant) => (variant.sku?.availableInventory ?? 0) > 0,
  );
}

export function activeFilterCount(filters: PlpFilters): number {
  return (
    (filters.room ? 1 : 0) +
    filters.solutions.length +
    (filters.priceBand ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0)
  );
}

export function filterProducts(products: readonly Product[], filters: PlpFilters): Product[] {
  return products.filter((product) => {
    if (filters.room && product.room !== filters.room) return false;
    if (
      filters.solutions.length > 0 &&
      !filters.solutions.some((s) => product.solutions.includes(s))
    ) {
      return false;
    }
    if (filters.priceBand) {
      const price = productCardPrice(product)?.price ?? null;
      if (price === null) return false;
      if (filters.priceBand === "0-1000" && price > 1000) return false;
      if (filters.priceBand === "1000-3000" && (price < 1000 || price > 3000)) return false;
      if (filters.priceBand === "3000-" && price < 3000) return false;
    }
    if (filters.inStockOnly && !isInStock(product)) return false;
    return true;
  });
}

/**
 * Sorting never reorders ties (decorate-sort-undecorate keeps the API's
 * newest-first order as the tie-breaker for "Recommendation").
 */
export function sortProducts(
  products: readonly Product[],
  sort: SortKey,
  bestsellerSlugs: ReadonlySet<string>,
): Product[] {
  const decorated = products.map((product, index) => {
    return {
      product,
      index,
      price: productCardPrice(product)?.price ?? null,
      inStock: isInStock(product),
      bestseller: bestsellerSlugs.has(product.slug),
    };
  });

  decorated.sort((a, b) => {
    switch (sort) {
      case "fast-dispatch":
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        break;
      case "price-asc":
        if (a.price === null && b.price !== null) return 1;
        if (a.price !== null && b.price === null) return -1;
        if (a.price !== null && b.price !== null && a.price !== b.price) {
          return a.price - b.price;
        }
        break;
      case "price-desc":
        if (a.price === null && b.price !== null) return 1;
        if (a.price !== null && b.price === null) return -1;
        if (a.price !== null && b.price !== null && a.price !== b.price) {
          return b.price - a.price;
        }
        break;
      case "recommended":
      default:
        if (a.bestseller !== b.bestseller) return a.bestseller ? -1 : 1;
        break;
    }
    return a.index - b.index;
  });

  return decorated.map((d) => d.product);
}
