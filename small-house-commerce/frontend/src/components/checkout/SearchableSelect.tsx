"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Searchable dropdown (combobox) for checkout address levels. One control
 * where the shopper can type to filter AND pick from the list — replaces the
 * previous split "search input + native select" for province/city/barangay
 * (zero-dep ruling, so no external combobox library).
 *
 * The committed `value` stays a valid PSGC name string: typing only filters;
 * an uncommitted query reverts to the last selection on blur/Escape. Arrow
 * keys move the active option, Enter commits it.
 */

interface SearchableSelectProps {
  id: string;
  testId: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  invalid?: boolean;
  describedBy?: string;
  loading?: boolean;
  ariaLabel: string;
}

const comboCls =
  "w-full rounded-lg border border-border bg-card py-2.5 pl-3 pr-9 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className ?? "h-4 w-4 text-ink-muted"}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchableSelect({
  id,
  testId,
  value,
  options,
  onChange,
  onBlur,
  disabled,
  placeholder,
  searchPlaceholder,
  invalid,
  describedBy,
  loading,
  ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    // Keep the current selection leading even when the query hides it.
    if (value && options.includes(value) && !base.includes(value)) {
      return [value, ...base];
    }
    return base;
  }, [options, query, value]);

  // Close (and drop any uncommitted query) on an outside pointer-down.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function select(name: string) {
    onChange(name);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  function handleFocus() {
    setQuery("");
    setOpen(true);
    setActiveIndex(-1);
  }

  function handleBlur() {
    // Blur means the value was already committed (option mousedown keeps focus
    // and commits first); an uncommitted query is discarded so the committed
    // value is never overwritten by free-typed text.
    setQuery("");
    setOpen(false);
    onBlur?.();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? Math.min(i + 1, filtered.length - 1) : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) select(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          data-testid={testId}
          className={`${comboCls}${invalid ? " border-sale" : ""}${
            disabled ? " cursor-not-allowed opacity-60" : ""
          }`}
          value={open ? query : value}
          placeholder={open ? searchPlaceholder : placeholder}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          <Chevron />
        </span>
      </div>

      {open && !loading && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {filtered.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={name === value}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                i === activeIndex ? "bg-cta/10" : ""
              } ${name === value ? "font-medium text-ink" : "text-ink-secondary"}
                hover:bg-cta/10`}
              onMouseDown={(e) => {
                // Commit before blur so the committed value is never discarded.
                e.preventDefault();
                select(name);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <svg
                viewBox="0 0 20 20"
                className={`h-4 w-4 shrink-0 ${name === value ? "text-cta" : "text-transparent"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <path d="M5 10l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}

      {open && loading && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-ink-muted shadow-lg">
          Loading…
        </div>
      )}

      {open && !loading && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-ink-muted shadow-lg">
          No matches.
        </div>
      )}
    </div>
  );
}