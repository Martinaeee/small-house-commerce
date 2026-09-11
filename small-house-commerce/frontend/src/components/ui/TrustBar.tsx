import type { ReactNode } from "react";

/**
 * DESIGN_SYSTEM §16 Trust Component — COD purchase confidence signals.
 * Shown on PDP, cart and checkout.
 */

const ITEMS: { icon: ReactNode; label: string; sub?: string }[] = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    label: "Cash on Delivery",
    sub: "Pay only when your order arrives",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M3 7h18v10H3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6.5 14.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    label: "Nationwide Delivery",
    sub: "Metro Manila 3-5 days, provinces 5-7",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
        <path d="M4 8h11v8H8l-4 3V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M15 11h3l2 2v3h-5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
    label: "Real-time Order Updates",
    sub: "Track your order by phone",
  },
];

export function TrustBar() {
  return (
    <section aria-label="Why shop with us">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
