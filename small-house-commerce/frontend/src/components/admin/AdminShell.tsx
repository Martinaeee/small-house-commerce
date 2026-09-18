"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";

/**
 * Admin back-office chrome + client route guard (spec §6, §8.2).
 *
 * States:
 *   guest    → redirect /admin/login?next=<current path>, render nothing
 *   loading  → full-height pulse skeleton (page-level TableSkeleton arrives
 *              in Task 4 and supersedes this later)
 *   authed   → sidebar/top-bar shell; when the permission filter leaves zero
 *              nav items (e.g. OPTIMIZER), the "No modules available" state
 *              replaces the page children entirely.
 *
 * Mobile (<768px) reuses the storefront mega-menu drawer interaction:
 * portaled slide-over, backdrop, Esc, focus trap, focus return to the trigger.
 * No storefront layout code is imported — only the pattern is mirrored.
 */

interface NavItem {
  href: string;
  /** i18n dictionary key (see src/i18n/zh.ts nav_*). */
  labelKey: string;
  permission: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin/orders", labelKey: "nav_orders", permission: "ORDER_VIEW_ALL" },
  { href: "/admin/inventory", labelKey: "nav_inventory", permission: "INVENTORY_VIEW" },
  { href: "/admin/products", labelKey: "nav_products", permission: "PRODUCT_MANAGE" },
  { href: "/admin/categories", labelKey: "nav_categories", permission: "PRODUCT_MANAGE" },
  { href: "/admin/collections", labelKey: "nav_collections", permission: "PRODUCT_MANAGE" },
  { href: "/admin/homepage", labelKey: "nav_homepage", permission: "PRODUCT_MANAGE" },
  { href: "/admin/single-pages", labelKey: "nav_single_pages", permission: "PRODUCT_MANAGE" },
  { href: "/admin/settings", labelKey: "nav_settings", permission: "SYSTEM_SETTINGS_EDIT" },
];

const FOCUSABLE = 'a[href], button:not([disabled])';

function navLinkClass(active: boolean): string {
  return [
    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-primary-light/40 text-cta"
      : "text-ink-secondary hover:bg-primary-light/40 hover:text-cta",
  ].join(" ");
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: { href: string; label: string }[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Admin navigation">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={navLinkClass(active)}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { status, admin, hasPermission, logout } = useAdminAuth();
  const { lang, setLang, t } = useAdminI18n();
  const router = useRouter();
  const pathname = usePathname();
  const drawerId = useId();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Client-only gate for the body portal (false on the server, true after
  // hydration); mirrors the storefront drawer.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Route guard: guests bounce to the login, which returns them here via ?next.
  useEffect(() => {
    if (status === "guest") {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  // Any navigation closes the drawer (the layout persists across routes).
  // Reconciled during render instead of an effect, per react-hooks rules.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setDrawerOpen(false);
  }

  // Drawer: scroll lock, initial focus, focus trap, Escape, focus return.
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
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
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

  const onLogout = useCallback(async () => {
    // logout() clears the session synchronously inside admin-auth; once the
    // provider flips to guest the guard effect would also redirect, but the
    // explicit replace keeps logout deterministic from every shell surface.
    await logout();
    router.replace("/admin/login");
  }, [logout, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-48 animate-pulse rounded bg-border" aria-label="Loading" />
      </div>
    );
  }

  if (status === "guest" || !admin) {
    // The guard effect performs the redirect.
    return null;
  }

  const nav = NAV_ITEMS.filter((item) => hasPermission(item.permission)).map((item) => ({
    href: item.href,
    label: t(item.labelKey as never),
  }));
  const current = nav.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const title = current?.label ?? "Admin";
  const roleCode = admin.roles[0]?.code;

  // Zero granted modules: the empty state replaces page children regardless
  // of what the routed page would render (OPTIMIZER has ORDER_VIEW_OWN only,
  // which no V1 module uses).
  const shellBody =
    nav.length === 0 ? (
      <div className="mx-auto mt-24 max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-base font-semibold text-ink">
          No modules available for your account.
        </p>
        <p className="mt-1 text-sm text-ink-secondary">Contact a Super Admin.</p>
        <Button variant="secondary" size="md" onClick={onLogout} className="mt-6">
          Log out
        </Button>
      </div>
    ) : (
      children
    );

  return (
    <>
      {/* Desktop fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center border-b border-border px-5">
          <span className="text-base font-bold text-cta">LUWAG Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList items={nav} pathname={pathname} />
        </div>
      </aside>

      <div className="md:pl-56">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:px-8">
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open admin menu"
            aria-expanded={drawerOpen}
            aria-controls={`${drawerId}-drawer`}
            className="flex items-center rounded-lg p-2 text-ink hover:text-cta md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-6 w-6">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <h1 className="flex-1 truncate text-lg font-semibold text-ink">{title}</h1>
          <span className="hidden text-sm text-ink-secondary sm:inline">{admin.name}</span>
          {roleCode && (
            <span className="rounded-full bg-primary-light/40 px-2 py-0.5 text-xs font-medium text-cta">
              {roleCode}
            </span>
          )}
          <button
            type="button"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            aria-label="Switch language"
            className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink-secondary hover:text-cta"
          >
            {lang === "zh" ? "EN" : "中文"}
          </button>
          <Button variant="text" size="md" onClick={onLogout} className="min-w-0 px-2">
            Log out
          </Button>
        </header>

        <main>{shellBody}</main>
      </div>

      {/* Mobile drawer (portaled to body) */}
      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
            aria-hidden={!drawerOpen}
            inert={!drawerOpen}
          >
            <div
              onClick={() => {
                setDrawerOpen(false);
                hamburgerRef.current?.focus();
              }}
              className={`absolute inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none ${
                drawerOpen ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={drawerRef}
              id={`${drawerId}-drawer`}
              role="dialog"
              aria-modal="true"
              aria-label="Admin menu"
              className={`absolute inset-y-0 left-0 flex w-64 flex-col bg-card shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
                drawerOpen ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-4">
                <span className="text-base font-bold text-cta">LUWAG Admin</span>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    hamburgerRef.current?.focus();
                  }}
                  aria-label="Close admin menu"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-primary-light/40"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-5 w-5">
                    <path
                      d="M6 6l12 12M18 6 6 18"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <NavList
                  items={nav}
                  pathname={pathname}
                  onNavigate={() => setDrawerOpen(false)}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
