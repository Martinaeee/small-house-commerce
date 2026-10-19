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
import { AdminGlobalHeader } from "@/components/admin/AdminGlobalHeader";
import { AdminGlobalSearch } from "@/components/admin/AdminGlobalSearch";
import { AdminNotifications } from "@/components/admin/AdminNotifications";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import studioStyles from "./homepage/HomepageStudio.module.css";

/**
 * Admin back-office chrome + client route guard (spec §6, §8.2).
 *
 * States:
 *   guest    → redirect /admin/login?next=<current path>, render nothing
 *   loading  → full-height pulse skeleton (page-level TableSkeleton arrives
 *              in Task 4 and supersedes this later)
 *   authed   → sidebar/top-bar shell; when the permission filter leaves zero
 *              nav items (e.g. OPTIMIZER), the "No modules available" state
 *              replaces page children except for authorized hidden routes.
 *
 * Mobile (<768px) reuses the storefront mega-menu drawer interaction:
 * portaled slide-over, backdrop, Esc, focus trap, focus return to the trigger.
 * No storefront layout code is imported — only the pattern is mirrored.
 */

type NavPermission = string | readonly string[];

interface NavItem {
  kind: "item";
  href: string;
  /** i18n dictionary key (see src/i18n/zh.ts nav_*). */
  labelKey: TKey;
  permission: NavPermission;
}

/**
 * A titled cluster of nav items. The group (and its title) renders only when
 * the account holds the group's permission and at least one item survives the
 * per-item permission filter.
 */
interface NavGroup {
  kind: "group";
  labelKey: TKey;
  permission: NavPermission;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const NAV_ITEMS: NavEntry[] = [
  {
    kind: "item",
    href: "/admin/orders",
    labelKey: "nav_orders",
    permission: "ORDER_VIEW_ALL",
  },
  {
    kind: "item",
    href: "/admin/inventory",
    labelKey: "nav_inventory",
    permission: "INVENTORY_VIEW",
  },
  {
    kind: "item",
    href: "/admin/products",
    labelKey: "nav_products",
    permission: "PRODUCT_MANAGE",
  },
  {
    kind: "item",
    href: "/admin/faq",
    labelKey: "nav_faq",
    permission: ["PRODUCT_FAQ_SHARED_MANAGE", "PRODUCT_MANAGE"],
  },
  {
    kind: "item",
    href: "/admin/groupings",
    labelKey: "nav_groupings",
    permission: "PRODUCT_MANAGE",
  },
  {
    kind: "group",
    labelKey: "nav_group_website",
    permission: [
      "PRODUCT_MANAGE",
      "STOREFRONT_SHELL_MANAGE",
      "SYSTEM_SETTINGS_EDIT",
    ],
    items: [
      {
        kind: "item",
        href: "/admin/homepage",
        labelKey: "nav_homepage",
        permission: "PRODUCT_MANAGE",
      },
      {
        kind: "item",
        href: "/admin/storefront-shell",
        labelKey: "nav_storefront_shell",
        permission: "STOREFRONT_SHELL_MANAGE",
      },
      {
        kind: "item",
        href: "/admin/settings",
        labelKey: "nav_settings",
        permission: "SYSTEM_SETTINGS_EDIT",
      },
    ],
  },
  {
    kind: "item",
    href: "/admin/marketing",
    labelKey: "marketing_title",
    permission: ["MARKETING_VIEW_OWN", "MARKETING_VIEW_ALL"],
  },
  {
    kind: "item",
    href: "/admin/newsletter",
    labelKey: "nav_newsletter",
    permission: "NEWSLETTER_READ",
  },
];

/** Permission-filtered render model: flat items plus titled groups. */
type NavRenderEntry =
  | { kind: "item"; href: string; label: string }
  | { kind: "group"; label: string; items: { href: string; label: string }[] };

const SEARCH_PERMISSIONS = [
  "PRODUCT_MANAGE",
  "ORDER_VIEW_ALL",
  "CUSTOMER_MANAGE",
] as const;

const FOCUSABLE = 'a[href], button:not([disabled])';

function hasNavPermission(
  hasPermission: (permission: string) => boolean,
  required: NavPermission,
): boolean {
  return typeof required === "string"
    ? hasPermission(required)
    : required.some((permission) => hasPermission(permission));
}

function navLinkClass(active: boolean): string {
  return [
    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-admin-rail-active text-white"
      : "text-admin-rail-muted hover:bg-admin-rail-hover hover:text-white",
  ].join(" ");
}

const NAV_ICON_PATHS: Record<string, string> = {
  "/admin/orders": "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6",
  "/admin/inventory": "M3 7h18v14H3V7Zm3-4h12v4H6V3Zm3 8h6",
  "/admin/products": "m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10v9m-9-14 9 5 9-5",
  "/admin/faq": "M4 4h16v13H9l-5 4V4Zm5 4a3 3 0 0 1 6 0c0 2-3 2-3 4m0 2h.01",
  "/admin/groupings": "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  "/admin/homepage": "m3 10 9-7 9 7v11h-6v-7H9v7H3V10Z",
  "/admin/storefront-shell": "M3 3h18v18H3V3Zm0 5h18M3 17h18",
  "/admin/settings": "M4 7h16M4 17h16M8 4v6m8 4v6",
  "/admin/marketing": "m3 9 17-6v18L3 15V9Zm4 7 2 6h4l-2-5",
  "/admin/newsletter": "M3 5h18v14H3V5Zm0 0 9 8 9-8",
};

function NavList({
  entries,
  pathname,
  onNavigate,
  compact = false,
}: {
  entries: NavRenderEntry[];
  pathname: string;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  return (
    <nav aria-label="Admin navigation">
      <ul className="flex flex-col gap-1">
        {entries.map((entry) =>
          entry.kind === "item" ? (
            <li key={entry.href}>
              <NavLink item={entry} pathname={pathname} onNavigate={onNavigate} compact={compact} />
            </li>
          ) : (
            <li key={entry.label}>
              <p className={compact ? "sr-only" : "px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-admin-rail-muted"}>
                {entry.label}
              </p>
              <ul className="flex flex-col gap-1">
                {entry.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      pathname={pathname}
                      onNavigate={onNavigate}
                      compact={compact}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
  compact = false,
}: {
  item: { href: string; label: string };
  pathname: string;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const active =
    pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={compact ? `${navLinkClass(active)} ${studioStyles.railLink}` : navLinkClass(active)}
      title={compact ? item.label : undefined}
    >
      {compact ? <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-5 w-5 shrink-0">
        <path d={NAV_ICON_PATHS[item.href]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg> : null}
      <span className={compact ? "sr-only" : undefined}>{item.label}</span>
    </Link>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { status, admin, hasPermission, logout } = useAdminAuth();
  const { t } = useAdminI18n();
  const router = useRouter();
  const pathname = usePathname();
  const isStudio = pathname === "/admin/homepage";
  const drawerId = useId();

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Studio opens on the icon rail; the rest of the back office keeps the full
  // menu. The choice is preserved across admin navigation either way.
  const [railExpanded, setRailExpanded] = useState(pathname !== "/admin/homepage");
  const railToggleRef = useRef<HTMLButtonElement>(null);
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

  const navEntries: NavRenderEntry[] = [];
  for (const entry of NAV_ITEMS) {
    if (!hasNavPermission(hasPermission, entry.permission)) continue;
    if (entry.kind === "item") {
      navEntries.push({
        kind: "item",
        href: entry.href,
        label: t(entry.labelKey),
      });
      continue;
    }
    const items = entry.items
      .filter((item) => hasNavPermission(hasPermission, item.permission))
      .map((item) => ({ href: item.href, label: t(item.labelKey) }));
    if (items.length > 0) {
      navEntries.push({ kind: "group", label: t(entry.labelKey), items });
    }
  }
  const navItems = navEntries.flatMap((entry) =>
    entry.kind === "item" ? [entry] : entry.items,
  );
  const current = navItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const title = current?.label ?? "Admin";
  // One source of truth for the notifications page: the route guard below and
  // the Bell's "View all" affordance must agree, or the link dead-ends.
  const canViewNotificationsPage =
    hasPermission("ORDER_CONFIRM") || hasPermission("PRODUCT_MANAGE");
  const isHiddenRoute =
    pathname === "/admin/search" ||
    pathname === "/admin/notifications" ||
    pathname.startsWith("/admin/customers/");
  const canRenderHiddenRoute =
    (pathname === "/admin/search" &&
      SEARCH_PERMISSIONS.some((permission) => hasPermission(permission))) ||
    (pathname === "/admin/notifications" && canViewNotificationsPage) ||
    (pathname.startsWith("/admin/customers/") &&
      hasPermission("CUSTOMER_MANAGE"));
  const hiddenRouteDenied = isHiddenRoute && !canRenderHiddenRoute;

  // Hidden destinations require their own permission even when another granted
  // module keeps the sidebar non-empty. Authorized hidden routes still mount
  // for role shapes (for example ORDER_CONFIRM-only) with no sidebar entries.
  const shellBody =
    hiddenRouteDenied || (navItems.length === 0 && !canRenderHiddenRoute) ? (
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
      <div data-admin-shell-mode={isStudio ? "homepage-studio" : "default"}
        className={`admin-shell min-h-screen bg-background ${isStudio ? studioStyles.studioShell : ""}`}>
        <aside
          className={`fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-admin-rail md:flex ${studioStyles.rail}${railExpanded ? ` ${studioStyles.railExpanded}` : ""}`}
          onKeyDown={(event) => {
            if (!railExpanded || event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setRailExpanded(false);
            railToggleRef.current?.focus();
          }}
        >
          <div className="flex h-14 items-center border-b border-white/10 px-3">
            <span className={!railExpanded ? "sr-only" : "text-base font-bold tracking-tight text-white"}>
              LUWAG <span className="font-medium text-admin-rail-muted">Admin</span>
            </span>
            <button ref={railToggleRef} type="button" aria-expanded={railExpanded}
              aria-controls={`${drawerId}-desktop-navigation`}
              aria-label={t(railExpanded ? "admin_nav_collapse" : "admin_nav_expand")}
              onClick={() => setRailExpanded((value) => !value)}
              className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white hover:bg-admin-rail-hover focus-visible:outline-2 focus-visible:outline-white">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-5 w-5">
                <path d={railExpanded ? "m14 6-6 6 6 6" : "M4 7h16M4 12h16M4 17h16"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div id={`${drawerId}-desktop-navigation`} className="flex-1 overflow-y-auto px-3 py-4">
            <NavList entries={navEntries} pathname={pathname} compact={!railExpanded} />
          </div>
        </aside>

        <div className={isStudio ? studioStyles.studioContent : `${studioStyles.railContent}${railExpanded ? "" : ` ${studioStyles.railContentCollapsed}`}`}>
          <AdminGlobalHeader
            moduleTitle={title}
            admin={admin}
            onLogout={onLogout}
            searchControl={<AdminGlobalSearch permissions={admin.permissions} />}
            notificationControl={
              <AdminNotifications canViewAll={canViewNotificationsPage} />
            }
            mobileMenuTrigger={
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
            }
          />

          <main className={`admin-app${isStudio ? ` ${studioStyles.studioApp}` : ""}`}>{shellBody}</main>
        </div>
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
              className={`absolute inset-y-0 left-0 flex w-64 flex-col bg-admin-rail shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
                drawerOpen ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                <span className="text-base font-bold tracking-tight text-white">
                  LUWAG{" "}
                  <span className="font-medium text-admin-rail-muted">Admin</span>
                </span>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    hamburgerRef.current?.focus();
                  }}
                  aria-label="Close admin menu"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-admin-rail-text hover:bg-admin-rail-hover"
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
                  entries={navEntries}
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
