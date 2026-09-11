import Link from "next/link";

/**
 * COLLECTION_SPEC §12 filters: room / solution / price band. Server-rendered
 * links (no JS): the active filter is kept while toggling one dimension, so
 * selections survive reloads and stay crawlable.
 */

const ROOMS = [
  { value: "BEDROOM", label: "Bedroom" },
  { value: "STORAGE", label: "Storage" },
  { value: "DINING_LIVING", label: "Dining & Living" },
  { value: "HOME_OFFICE", label: "Home Office" },
] as const;

const SOLUTIONS = [
  { value: "FOLDABLE", label: "Foldable" },
  { value: "NARROW_SPACE", label: "Narrow Space" },
  { value: "MOBILE", label: "Mobile" },
  { value: "MULTIFUNCTIONAL", label: "Multi-purpose" },
  { value: "HIDDEN_STORAGE", label: "Hidden Storage" },
  { value: "RENTAL_FRIENDLY", label: "Rental Friendly" },
] as const;

const PRICE_BANDS = [
  { min: 0, max: 1000, label: "Under ₱1,000" },
  { min: 1000, max: 3000, label: "₱1,000 – ₱3,000" },
  { min: 3000, max: undefined, label: "Above ₱3,000" },
] as const;

interface CollectionFiltersProps {
  /** Listing path the filter links point at, e.g. /collections/x or /categories/y. */
  basePath: string;
  active: { room?: string; solution?: string; minPrice?: string; maxPrice?: string };
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-cta bg-cta text-white"
          : "border-border bg-card text-ink-secondary hover:border-primary hover:text-cta"
      }`}
    >
      {children}
    </Link>
  );
}

export function CollectionFilters({ basePath, active }: CollectionFiltersProps) {
  // Builds a query string keeping every other dimension as-is.
  const qs = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...active, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const q = params.toString();
    return q ? `?${q}` : "";
  };

  const base = basePath;

  const activePrice = active.minPrice !== undefined ? `${active.minPrice}-${active.maxPrice ?? ""}` : undefined;

  return (
    <div className="flex flex-col gap-3">
      {/* Room */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Room
        </span>
        <FilterLink href={`${base}${qs({ room: undefined })}`} active={!active.room}>
          All
        </FilterLink>
        {ROOMS.map((room) => (
          <FilterLink
            key={room.value}
            href={`${base}${qs({ room: room.value })}`}
            active={active.room === room.value}
          >
            {room.label}
          </FilterLink>
        ))}
      </div>

      {/* Solution */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Solution
        </span>
        <FilterLink href={`${base}${qs({ solution: undefined })}`} active={!active.solution}>
          All
        </FilterLink>
        {SOLUTIONS.map((solution) => (
          <FilterLink
            key={solution.value}
            href={`${base}${qs({ solution: solution.value })}`}
            active={active.solution === solution.value}
          >
            {solution.label}
          </FilterLink>
        ))}
      </div>

      {/* Price */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Price
        </span>
        <FilterLink href={`${base}${qs({ minPrice: undefined, maxPrice: undefined })}`} active={!activePrice}>
          All
        </FilterLink>
        {PRICE_BANDS.map((band) => (
          <FilterLink
            key={band.label}
            href={`${base}${qs({ minPrice: String(band.min), maxPrice: band.max !== undefined ? String(band.max) : undefined })}`}
            active={activePrice === `${band.min}-${band.max ?? ""}`}
          >
            {band.label}
          </FilterLink>
        ))}
      </div>
    </div>
  );
}
