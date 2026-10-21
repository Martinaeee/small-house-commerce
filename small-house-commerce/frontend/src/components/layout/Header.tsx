import Link from "next/link";
import type { NavItem } from "@/lib/nav";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";
import { AccountEntry } from "@/components/auth/AccountEntry";
import { CartBadge } from "@/components/cart/CartBadge";
import { MainNav } from "./MainNav";
import { SiteSearch } from "./SiteSearch";
import { BrandWordmark } from "./BrandWordmark";

type HeaderProps = {
  navItems: NavItem[];
  brand?: PublicStorefrontShell["brand"];
  mode?: "live" | "preview";
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m16 16 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c.8-3.4 3.4-5 7-5s6.2 1.6 7 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <path
        d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 9V6a3.5 3.5 0 0 1 7 0v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StaticSearch() {
  return (
    <div
      aria-label="Search"
      aria-disabled="true"
      className="ml-auto flex items-center text-ink lg:mx-auto lg:w-full lg:max-w-[560px] lg:flex-1 xl:ml-auto xl:mr-0 xl:w-40 xl:max-w-none xl:flex-none"
    >
      <span className="flex rounded-lg p-1.5 max-[374px]:p-1 lg:hidden">
        <SearchIcon />
      </span>
      <span className="hidden h-11 w-full items-center gap-2 rounded-full border border-border bg-card px-3 text-sm text-ink-muted lg:flex">
        <SearchIcon />
        Search…
      </span>
    </div>
  );
}

/**
 * Shared storefront Header. Preview mode keeps the same shell geometry while
 * replacing every customer/router island with inert visual equivalents.
 */
export function Header({ navItems, brand, mode = "live" }: HeaderProps) {
  const brandName = brand?.brandName ?? "LUWAG";
  const marks = (
    <>
      <span className="hidden items-center lg:inline-flex">
        <BrandWordmark
          brand={brand}
          variant="horizontal"
          decorative
          className="text-lg"
        />
      </span>
      <span className="inline-flex items-center lg:hidden">
        <BrandWordmark
          brand={brand}
          variant="square"
          decorative
          className="text-lg"
        />
      </span>
    </>
  );
  const homeClassName =
    "absolute left-1/2 flex -translate-x-1/2 shrink-0 items-center max-[374px]:text-[15px] lg:static lg:left-auto lg:translate-x-0 lg:text-lg";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center gap-x-3 px-4 max-[374px]:gap-x-0 sm:gap-x-6 sm:px-6 xl:gap-x-2.5">
        {mode === "live" ? (
          <Link
            href="/"
            aria-label={`${brandName} home`}
            className={homeClassName}
          >
            {marks}
          </Link>
        ) : (
          <span aria-label={`${brandName} home`} className={homeClassName}>
            {marks}
          </span>
        )}

        <MainNav items={navItems} brand={brand} mode={mode} />

        {mode === "live" ? <SiteSearch /> : <StaticSearch />}

        <div className="flex shrink-0 items-center gap-0 lg:gap-1">
          {mode === "live" ? (
            <>
              <AccountEntry />
              <Link
                href="/cart"
                className="relative flex items-center gap-2 rounded-lg p-1.5 text-ink hover:text-cta max-[374px]:p-1 lg:p-2"
                aria-label="Shopping cart"
              >
                <CartIcon />
                <CartBadge />
              </Link>
            </>
          ) : (
            <>
              <span
                aria-label="Account"
                aria-disabled="true"
                className="flex rounded-lg p-1.5 text-ink max-[374px]:p-1 lg:p-2"
              >
                <AccountIcon />
              </span>
              <span
                aria-label="Shopping cart"
                aria-disabled="true"
                className="flex rounded-lg p-1.5 text-ink max-[374px]:p-1 lg:p-2"
              >
                <CartIcon />
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
