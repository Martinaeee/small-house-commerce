"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Category } from "@/lib/api";
import type { NavItem, NavTree } from "@/lib/nav";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

/**
 * Castlery-style main navigation (spec 2026-09-11-navigation-mega-menu-design).
 * Desktop: hover/focus mega menu with link columns + image cards.
 * Mobile: left slide-in drawer with an accordion of thumbnail leaf rows.
 *
 * Both overlays portal to document.body: the header carries backdrop-blur,
 * which would otherwise become the containing block for fixed descendants.
 */

const MEGA_CLOSE_DELAY_MS = 140;
const FOCUSABLE = 'a[href], button:not([disabled])';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 shrink-0">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Leaf visual: real image when present, beige placeholder until photography lands. */
function LeafThumb({ leaf, className }: { leaf: Category; className: string }) {
  return leaf.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={leaf.imageUrl} alt={leaf.name} loading="lazy" className={`object-cover ${className}`} />
  ) : (
    <PlaceholderImage label={leaf.name} className={className} />
  );
}

export function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const navId = useId();

  const [desktopOpen, setDesktopOpen] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(64);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Client-only gate for the body portals (false on the server, true after
  // hydration); useSyncExternalStore avoids setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const closeTimer = useRef<number | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const openDesktop = useCallback(
    (slug: string, top: number) => {
      cancelClose();
      setPanelTop(top);
      setDesktopOpen(slug);
    },
    [cancelClose],
  );

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setDesktopOpen(null), MEGA_CLOSE_DELAY_MS);
  }, [cancelClose]);

  // Any navigation closes every overlay (the layout island persists across
  // routes). Reconciled during render (React "adjust state on prop change")
  // instead of an effect, per react-hooks rules.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setDesktopOpen(null);
    setDrawerOpen(false);
  }

  useEffect(() => () => cancelClose(), [cancelClose]);

  // Click outside closes the desktop panel.
  useEffect(() => {
    if (!desktopOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!e.target || !(e.target instanceof Node)) return;
      if (e.target instanceof Element && e.target.closest("[data-nav-root]")) return;
      const panel = document.getElementById(`${navId}-mega-panel`);
      if (panel && panel.contains(e.target)) return;
      setDesktopOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [desktopOpen, navId]);

  // Scrolling closes the panel: its fixed offset under the sticky header would
  // otherwise drift once the announcement bar scrolls away.
  useEffect(() => {
    if (!desktopOpen) return;
    const onScroll = () => setDesktopOpen(null);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [desktopOpen]);

  // Drawer: scroll lock, initial focus, focus trap, Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        hamburgerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusables = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const openTreeItem = items.find(
    (item): item is NavTree => item.kind === "tree" && item.root.slug === desktopOpen,
  );

  return (
    <>
      {/* Hamburger (mobile only) */}
      <button
        ref={hamburgerRef}
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open menu"
        aria-expanded={drawerOpen}
        aria-controls={`${navId}-drawer`}
        className="flex items-center rounded-lg p-2 text-ink hover:text-cta lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-6 w-6">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {/* Desktop navigation triggers — full-width second row of the header
          (order-6 + basis-full wrap it under the logo/search/icons line). */}
      <nav
        aria-label="Main navigation"
        // lg: second row of the wrapping header (order-6/basis-full).
        // xl: inline after the logo on the single merged row.
        className="order-6 hidden basis-full items-center gap-x-5 pb-2 pt-0.5 lg:flex xl:order-none xl:basis-auto xl:gap-x-2.5 xl:pb-0 xl:pt-0"
      >
        {items.map((item) =>
          item.kind === "link" ? (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 text-sm font-medium text-ink hover:text-cta xl:text-[13px]"
            >
              {item.label}
            </Link>
          ) : (
            <div
                      key={item.root.id}
                      data-nav-root
                      onMouseEnter={(e) =>
                        openDesktop(
                          item.root.slug,
                          e.currentTarget.closest("header")?.getBoundingClientRect().bottom ?? 64,
                        )
                      }
                      onMouseLeave={scheduleClose}
                      onBlurCapture={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) scheduleClose();
                      }}
                    >
              <span className="flex items-center gap-1">
                <Link
                  href={`/categories/${item.root.slug}`}
                  onFocus={(e) =>
                    openDesktop(
                      item.root.slug,
                      e.currentTarget.closest("header")?.getBoundingClientRect().bottom ?? 64,
                    )
                  }
                  aria-expanded={desktopOpen === item.root.slug}
                  aria-controls={`${navId}-mega-panel`}
                  className="shrink-0 py-2 text-sm font-medium text-ink hover:text-cta xl:text-[13px]"
                >
                  {item.root.name}
                </Link>
                {/* Chevron hidden on the tight single xl row; hover/focus still
                    opens the mega panel and the label itself links to the
                    category. Kept on the lg two-row header. */}
                <span aria-hidden className="py-2 text-ink xl:hidden">
                  <Chevron open={desktopOpen === item.root.slug} />
                </span>
              </span>
            </div>
          ),
        )}
      </nav>

      {/* Desktop full-width mega panel (portaled under the sticky header) */}
      {mounted && openTreeItem &&
        createPortal(
          <div
            id={`${navId}-mega-panel`}
            role="region"
            aria-label={openTreeItem.root.name}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{ top: panelTop }}
            className="fixed inset-x-0 z-40 border-b border-border bg-background shadow-lg"
          >
            <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-10 px-6 py-8">
              <div>
                <Link
                  href={`/categories/${openTreeItem.root.slug}`}
                  className="text-sm font-semibold text-cta hover:underline"
                >
                  View all {openTreeItem.root.name}
                </Link>
                <ul className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2.5">
                  {openTreeItem.root.children.map((leaf) => (
                    <li key={leaf.id}>
                      <Link
                        href={`/categories/${leaf.slug}`}
                        className="text-sm text-ink-secondary hover:text-cta"
                      >
                        {leaf.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {openTreeItem.root.children.slice(0, 3).map((leaf) => (
                  <Link key={leaf.id} href={`/categories/${leaf.slug}`} className="group block">
                    <LeafThumb
                      leaf={leaf}
                      className="aspect-[4/3] w-full overflow-hidden rounded-lg border border-border"
                    />
                    <span className="mt-2 flex items-center gap-1.5 text-sm font-medium text-ink group-hover:text-cta">
                      {leaf.name}
                      <ArrowRight />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Mobile drawer (portaled so it escapes the blurred sticky header) */}
      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-50 lg:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
            aria-hidden={!drawerOpen}
            inert={!drawerOpen}
          >
            <div
              onClick={closeDrawer}
              className={`absolute inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none ${
                drawerOpen ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={drawerRef}
              id={`${navId}-drawer`}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className={`absolute inset-y-0 left-0 flex w-[85%] max-w-[380px] flex-col bg-background shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
                drawerOpen ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-4">
                <span className="text-base font-bold text-cta">Small House PH</span>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    hamburgerRef.current?.focus();
                  }}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-primary-light/40"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-5 w-5">
                    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto px-2 py-3">
                <ul className="flex flex-col">
                  {items.map((item) => (
                    <li key={item.kind === "link" ? item.href : item.root.id}>
                      {item.kind === "link" ? (
                        <Link
                          href={item.href}
                          onClick={closeDrawer}
                          className="block rounded-lg px-3 py-3 text-base font-medium text-ink hover:bg-primary-light/40 hover:text-cta"
                        >
                          {item.label}
                        </Link>
                      ) : (
                        <div>
                          <div className="flex items-center">
                            <Link
                              href={`/categories/${item.root.slug}`}
                              onClick={closeDrawer}
                              className="flex-1 rounded-lg px-3 py-3 text-base font-medium text-ink hover:bg-primary-light/40 hover:text-cta"
                            >
                              {item.root.name}
                            </Link>
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((cur) =>
                                  cur === item.root.slug ? null : item.root.slug,
                                )
                              }
                              aria-expanded={expanded === item.root.slug}
                              aria-controls={`${navId}-acc-${item.root.slug}`}
                              aria-label={`${item.root.name} subcategories`}
                              className="rounded-lg p-3 text-ink hover:text-cta"
                            >
                              <Chevron open={expanded === item.root.slug} />
                            </button>
                          </div>

                          {expanded === item.root.slug && (
                            <div id={`${navId}-acc-${item.root.slug}`} className="pb-2">
                              <Link
                                href={`/categories/${item.root.slug}`}
                                onClick={closeDrawer}
                                className="block rounded-lg px-3 py-2 pl-6 text-sm font-semibold text-cta hover:underline"
                              >
                                View all {item.root.name}
                              </Link>
                              <ul>
                                {item.root.children.map((leaf) => (
                                  <li key={leaf.id}>
                                    <Link
                                      href={`/categories/${leaf.slug}`}
                                      onClick={closeDrawer}
                                      className="flex items-center justify-between gap-3 rounded-lg py-2 pl-6 pr-3 hover:bg-primary-light/40"
                                    >
                                      <span className="text-sm text-ink-secondary">{leaf.name}</span>
                                      <LeafThumb
                                        leaf={leaf}
                                        className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border"
                                      />
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
