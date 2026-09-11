"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { api, type Product } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatPrice } from "@/components/ui/PriceBox";

/**
 * IKEA-style header search (spec §4). Desktop: rounded pill in the header.
 * Mobile: magnifier that opens a bar under the sticky header. Suggestions
 * are portaled to document.body (the blurred header is a containing block
 * for fixed descendants — same lesson as the mega menu).
 */
const DEBOUNCE_MS = 250;
const SUGGESTION_LIMIT = 6;

function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

interface AnchorRect {
  top: number;
  left: number;
  width: number;
}

export function SiteSearch() {
  const router = useRouter();
  const navId = useId();
  // Portals render client-only: false on the server and first paint.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileBarTop, setMobileBarTop] = useState(0);
  const [activeRow, setActiveRow] = useState(-1);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2;

  // Debounced suggestion fetch with stale-response protection. State is set
  // only from the timer/callbacks — never synchronously in the effect body
  // (react-hooks/set-state-in-effect; same convention as AuthProvider).
  useEffect(() => {
    if (!canSearch) return;
    const mySeq = ++seq.current;
    const timer = window.setTimeout(() => {
      // "Searching…" starts when the request actually fires (after debounce).
      setLoading(true);
      api
        .getProducts({ search: trimmed, pageSize: SUGGESTION_LIMIT })
        .then((page) => {
          if (mySeq !== seq.current) return;
          setResults(page.items);
          setLoading(false);
        })
        .catch(() => {
          if (mySeq !== seq.current) return;
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, canSearch]);

  // Focus the mobile input as soon as its bar is mounted.
  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  // Scrolling closes every overlay (the sticky header offsets change).
  useEffect(() => {
    if (!open && !mobileOpen) return;
    const onScroll = () => {
      setOpen(false);
      setMobileOpen(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open, mobileOpen]);

  const measure = useCallback((input: HTMLInputElement) => {
    const rect = input.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  const closeAll = useCallback(() => {
    setOpen(false);
    setMobileOpen(false);
  }, []);

  const goToResults = useCallback(
    (value: string) => {
      const q = value.trim();
      if (!q) return;
      closeAll();
      router.push(`/search?q=${encodeURIComponent(q)}`);
    },
    [router, closeAll],
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeRow >= 0 && results[activeRow]) {
      const product = results[activeRow];
      closeAll();
      router.push(`/products/${product.slug}`);
      return;
    }
    goToResults(query);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && open && results.length > 0) {
      event.preventDefault();
      setActiveRow((cur) => (cur + 1) % results.length);
    } else if (event.key === "ArrowUp" && open && results.length > 0) {
      event.preventDefault();
      setActiveRow((cur) => (cur <= -1 ? results.length - 1 : cur - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveRow(-1);
    }
  }

  // One field description, instantiated separately for the desktop pill and
  // the mobile bar so the mobile input deterministically owns its ref.
  const renderField = (inputRef: { current: HTMLInputElement | null } | null) => (
    <form role="search" onSubmit={onSubmit} className="w-full">
      <div className="relative w-full">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef ?? undefined}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveRow(-1);
            // Reset immediately when the term drops below the search threshold.
            if (e.target.value.trim().length < 2) {
              setResults([]);
              setLoading(false);
            }
          }}
          onFocus={(e) => {
            setOpen(true);
            measure(e.currentTarget);
          }}
          onClick={(e) => measure(e.currentTarget)}
          onKeyDown={onKeyDown}
          role="combobox"
          placeholder="Search furniture…"
          aria-label="Search products"
          aria-expanded={open}
          aria-controls={`${navId}-search-suggestions`}
          className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
        />
      </div>
    </form>
  );

  return (
    <>
      {/* Mobile: icon button. ml-auto pushes the mobile icon group
          (search/account/cart) to the right edge; on desktop this button is
          hidden and the pill below carries its own ml-auto. */}
      <button
        type="button"
        onClick={() => {
          const header = document.querySelector("header");
          setMobileBarTop(header?.getBoundingClientRect().bottom ?? 0);
          setMobileOpen(true);
        }}
        aria-label="Search"
        className="ml-auto flex items-center rounded-lg p-2 text-ink hover:text-cta lg:hidden"
      >
        <SearchIcon className="h-6 w-6" />
      </button>

      {/* Desktop: pill (ml-auto pushes it to the right of the nav) */}
      <div className="ml-auto hidden w-full max-w-[420px] lg:block">{renderField(null)}</div>

      {/* Mobile full-width bar under the sticky header */}
      {mounted &&
        mobileOpen &&
        createPortal(
          <div
            className="fixed inset-x-0 z-50 border-b border-border bg-background p-3 shadow-lg lg:hidden"
            style={{ top: mobileBarTop }}
          >
            <div className="flex items-center gap-2">
              <div className="flex-1">{renderField(mobileInputRef)}</div>
              <button
                type="button"
                onClick={closeAll}
                aria-label="Close search"
                className="rounded-lg p-2 text-ink hover:text-cta"
              >
                ✕
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* Suggestions dropdown (desktop and mobile) */}
      {mounted &&
        open &&
        canSearch &&
        anchor &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close suggestions"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div
              id={`${navId}-search-suggestions`}
              className="fixed z-50 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
              style={{ top: anchor.top, left: anchor.left, width: anchor.width }}
              role="listbox"
            >
              {loading && results.length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-muted">Searching…</p>
              ) : results.length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-muted">
                  No matches — press Enter to search
                </p>
              ) : (
                <ul className="max-h-[360px] overflow-y-auto py-1">
                  {results.map((product, index) => {
                    const firstImage = product.images[0]?.url;
                    const price = product.variants[0]?.sku?.price ?? null;
                    return (
                      <li key={product.id}>
                        <Link
                          href={`/products/${product.slug}`}
                          onClick={closeAll}
                          onMouseEnter={() => setActiveRow(index)}
                          role="option"
                          aria-selected={activeRow === index}
                          className={`flex items-center gap-3 px-3 py-2 ${
                            activeRow === index ? "bg-primary-light/40" : ""
                          }`}
                        >
                          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
                            {firstImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={firstImage}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <PlaceholderImage label="" className="h-full w-full" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {product.name}
                            </span>
                            <span className="text-sm font-semibold text-ink">
                              {price !== null ? formatPrice(price) : ""}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  <li className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => goToResults(query)}
                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-cta hover:bg-primary-light/40"
                    >
                      See all results for “{trimmed}”
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
