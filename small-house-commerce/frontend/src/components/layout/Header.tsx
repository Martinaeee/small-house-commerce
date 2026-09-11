import Link from "next/link";
import type { Collection } from "@/lib/api";

/**
 * DESIGN_SYSTEM §11 Navigation + FRONTEND_SPEC §15 Header.
 * Navigation data comes from the backend Collection API — never hard-coded.
 * Logo + nav + cart on desktop; logo + cart + menu on mobile.
 */

const LOGO = "Small House PH";

export function Header({ collections }: { collections: Collection[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="shrink-0 text-lg font-bold text-cta">
          {LOGO}
        </Link>

        {/* Desktop navigation */}
        <nav aria-label="Main navigation" className="hidden flex-1 items-center gap-5 lg:flex">
          {collections.map((collection) => (
            <Link
              key={collection.id}
              href={`/collections/${collection.slug}`}
              className="text-sm font-medium text-ink hover:text-cta"
            >
              {collection.name}
            </Link>
          ))}
        </nav>

        {/* Cart */}
        <Link
          href="/cart"
          className="ml-auto flex items-center gap-2 rounded-lg p-2 text-ink hover:text-cta"
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

        {/* Mobile menu */}
        <details className="lg:hidden">
          <summary
            className="flex cursor-pointer list-none items-center rounded-lg p-2 text-ink"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </summary>
          <nav
            aria-label="Mobile navigation"
            className="absolute inset-x-0 top-16 border-b border-border bg-background px-4 py-4 shadow-lg"
          >
            <ul className="flex flex-col gap-1">
              {collections.map((collection) => (
                <li key={collection.id}>
                  <Link
                    href={`/collections/${collection.slug}`}
                    className="block rounded-lg px-3 py-2.5 text-base font-medium text-ink hover:bg-primary-light/40 hover:text-cta"
                  >
                    {collection.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}
