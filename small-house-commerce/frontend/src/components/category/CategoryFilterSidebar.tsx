import {
  PRICE_BAND_OPTIONS,
  ROOM_OPTIONS,
  SOLUTION_OPTIONS,
  activeFilterCount,
  type PlpFilters,
  type PriceBand,
} from "@/lib/plp";
import type { Room, Solution } from "@/lib/api";

/**
 * Controlled filter body shared by the desktop sticky sidebar and the mobile
 * filter drawer. Only dimensions backed by real product data exist here:
 * room, solution, price band, in-stock. No colour/material placeholders.
 */
interface CategoryFilterSidebarProps {
  filters: PlpFilters;
  onChange: (next: PlpFilters) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-border pb-4">
      <legend className="mb-2 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

const rowClass = "flex items-center gap-2 py-1 text-sm text-ink-secondary";
const radioClass =
  "h-4 w-4 accent-cta cursor-pointer disabled:cursor-not-allowed";

export function CategoryFilterSidebar({ filters, onChange }: CategoryFilterSidebarProps) {
  const selectRoom = (room: Room) => onChange({ ...filters, room });
  const toggleSolution = (solution: Solution) =>
    onChange({
      ...filters,
      solutions: filters.solutions.includes(solution)
        ? filters.solutions.filter((s) => s !== solution)
        : [...filters.solutions, solution],
    });
  const selectPriceBand = (band: PriceBand) => onChange({ ...filters, priceBand: band });

  return (
    <div className="flex flex-col gap-4">
      <Section title="Room">
        <div className="flex flex-col">
          <label className={rowClass}>
            <input
              type="radio"
              name="plp-room"
              className={radioClass}
              checked={filters.room === null}
              onChange={() => onChange({ ...filters, room: null })}
            />
            All rooms
          </label>
          {ROOM_OPTIONS.map((option) => (
            <label key={option.value} className={rowClass}>
              <input
                type="radio"
                name="plp-room"
                className={radioClass}
                checked={filters.room === option.value}
                onChange={() => selectRoom(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Solution">
        <div className="flex flex-col">
          {SOLUTION_OPTIONS.map((option) => (
            <label key={option.value} className={rowClass}>
              <input
                type="checkbox"
                className={radioClass}
                checked={filters.solutions.includes(option.value)}
                onChange={() => toggleSolution(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Price">
        <div className="flex flex-col">
          <label className={rowClass}>
            <input
              type="radio"
              name="plp-price"
              className={radioClass}
              checked={filters.priceBand === null}
              onChange={() => onChange({ ...filters, priceBand: null })}
            />
            All prices
          </label>
          {PRICE_BAND_OPTIONS.map((option) => (
            <label key={option.value} className={rowClass}>
              <input
                type="radio"
                name="plp-price"
                className={radioClass}
                checked={filters.priceBand === option.value}
                onChange={() => selectPriceBand(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Availability">
        <label className={rowClass}>
          <input
            type="checkbox"
            className={radioClass}
            checked={filters.inStockOnly}
            onChange={(e) => onChange({ ...filters, inStockOnly: e.target.checked })}
          />
          In stock only
        </label>
      </Section>

      {activeFilterCount(filters) > 0 && (
        <button
          type="button"
          onClick={() =>
            onChange({ room: null, solutions: [], priceBand: null, inStockOnly: false })
          }
          className="text-left text-sm text-cta hover:underline"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
