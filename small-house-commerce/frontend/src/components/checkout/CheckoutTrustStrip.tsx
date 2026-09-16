"use client";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";

// 24x24 viewBox 内联 SVG，stroke=currentColor，风格同 PdpClient 货车 glyph。
const icons = {
  banknote: (
    <path d="M3 7h18v10H3z M6 9v1 M18 14v1 M7 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M15 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
  ),
  calendar: (
    <path d="M4 5h16v16H4z M4 9h16 M8 3v4 M16 3v4" />
  ),
  bubble: (
    <path d="M4 5h16v11H11l-4 4v-4H4z" />
  ),
  shield: (
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4" />
  ),
} as const;

interface TrustItem { icon: keyof typeof icons; label: string }
const TRUST_ITEMS: TrustItem[] = [
  { icon: "banknote", label: "COD & Free Shipping" },
  { icon: "calendar", label: "Estimated delivery {range}" },
  { icon: "bubble", label: "Support {hours}" },
  { icon: "shield", label: "Inspect at delivery · 48h exchange for defects" },
];

export function CheckoutTrustStrip({ deliveryRange }: { deliveryRange: string }) {
  const { supportHours } = useSiteSettings();
  return (
    <ul
      data-testid="checkout-trust-strip"
      className="flex flex-col gap-3 text-xs text-ink-secondary sm:flex-row sm:flex-wrap sm:gap-x-6"
    >
      {TRUST_ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-cta" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icons[item.icon]}
          </svg>
          <span>
            {item.label === "Estimated delivery {range}"
              ? `Estimated delivery ${deliveryRange}`
              : item.label === "Support {hours}"
                ? `Support ${supportHours}`
                : item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
