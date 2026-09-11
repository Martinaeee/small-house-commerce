import Link from "next/link";
import type { NavItem } from "@/lib/nav";
import { AccountEntry } from "@/components/auth/AccountEntry";
import { MainNav } from "./MainNav";
import { SiteSearch } from "./SiteSearch";

/**
 * DESIGN_SYSTEM §11 Navigation + HOMEPAGE_SPEC §6 Header.
 * Sits below the site-wide AnnouncementBar and sticks to the top on scroll.
 * Desktop (lg+): two rows in one wrapping flex line — row 1 logo | search
 * pill | account/cart, row 2 the full-width mega-menu nav (order-6 /
 * basis-full). Mobile: hamburger (left) + centered logo + compact search /
 * account / cart targets; hamburger opens MainNav's left slide-in drawer.
 */

const LOGO = "Small House PH";

export function Header({ navItems }: { navItems: NavItem[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center gap-x-3 px-4 sm:gap-x-6 sm:px-6">
        {/* Logo: first in flow on desktop; absolutely centered on mobile
            (the in-flow hamburger/cart then occupy left/right). */}
        <Link
          href="/"
          className="absolute left-1/2 -translate-x-1/2 shrink-0 text-base font-bold text-cta max-[374px]:text-[15px] lg:static lg:left-auto lg:translate-x-0 lg:text-lg"
        >
          {LOGO}
        </Link>

        {/* Hamburger (mobile) + desktop mega-menu nav */}
        <MainNav items={navItems} />

        <SiteSearch />

        {/* Account + cart: tight on mobile (three 36px tap targets), natural
            gap with the greeting on desktop. */}
        <div className="flex shrink-0 items-center gap-0 lg:gap-1">
          <AccountEntry />
          <Link
            href="/cart"
            className="flex items-center gap-2 rounded-lg p-1.5 text-ink hover:text-cta lg:p-2"
            aria-label="Shopping cart"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
              <path
                d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 7Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M8.5 9V6a3.5 3.5 0 0 1 7 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}
