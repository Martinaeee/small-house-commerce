import type { ReactNode } from "react";

/**
 * HOMEPAGE_SPEC §12 USP Trust Bar + DESIGN_SYSTEM §16.
 * Defaults: Cash On Delivery / Made For Small Spaces / Secure Checkout /
 * Philippines Delivery. (CMS-editable in a later slice.)
 */

const ITEMS: { icon: ReactNode; label: string; sub?: string }[] = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    label: "Cash On Delivery",
    sub: "Pay only when your order arrives",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M3 4h11v11H8l-5 4V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 8h4l3 3v4h-7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
    label: "Made For Small Spaces",
    sub: "Furniture designed for condos & rentals",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="15" r="1.4" fill="currentColor" />
      </svg>
    ),
    label: "Secure Checkout",
    sub: "Your details stay private",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M3 7h18v10H3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6.5 14.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    label: "Philippines Delivery",
    sub: "Metro Manila 3-5 days, provinces 5-7",
  },
];

export function TrustBar() {
  return (
    <section aria-label="Why shop with us">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ITEMS.map((item) => (
          <li
            key={item.label}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-4"
          >
            <span className="mt-0.5 shrink-0 text-cta">{item.icon}</span>
            <span>
              <span className="block text-sm font-semibold text-ink">{item.label}</span>
              {item.sub && (
                <span className="block text-xs text-ink-secondary">{item.sub}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
