"use client";

import { useEffect, useState } from "react";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import {
  readStoredNewsletterCode,
  requestNewsletterOffer,
} from "./newsletterOfferChannel";

function sameCode(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * The subscriber offer inside the checkout totals. It opens the subscribe
 * popup on demand — a shopper who taps it gets the code, and the code is put
 * on the running total by the promo field. The copy comes from the storefront
 * settings and only renders while the server reports a live promotion.
 *
 * Once the revealed code is the one on the order, the card shows a check
 * instead of the "Get code" pill so the discount is not offered twice.
 */
export function NewsletterOfferPrompt({
  appliedCode = null,
}: {
  appliedCode?: string | null;
}) {
  const settings = useSiteSettings();
  const [grantedCode, setGrantedCode] = useState<string | null>(null);

  // Read after mount so the server render stays free of browser-only storage.
  // Re-read when the applied code changes: a subscription can reveal the code
  // and put it on the total while this card is already open.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      setGrantedCode(readStoredNewsletterCode());
    })();
    return () => {
      alive = false;
    };
  }, [appliedCode]);

  const title =
    typeof settings.newsletterOfferTitle === "string"
      ? settings.newsletterOfferTitle.trim()
      : "";
  if (!settings.newsletterOfferAvailable || title === "") return null;

  if (sameCode(appliedCode, grantedCode)) {
    return (
      <div
        data-testid="newsletter-offer-prompt"
        className="mt-3 flex w-full items-center gap-3 rounded-lg border border-cta/30 bg-primary-light/60 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug text-cta">
            {title}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-secondary">
            Your subscriber discount is included in the order total.
          </span>
        </span>
        <span
          data-testid="newsletter-offer-applied"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cta px-2.5 py-1 text-xs font-semibold text-cta-foreground"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3.5 8.5 3 3 6-6" />
          </svg>
          Applied
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="newsletter-offer-prompt"
      onClick={() => requestNewsletterOffer()}
      className="mt-3 flex w-full items-center gap-3 rounded-lg border border-cta/30 bg-primary-light/60 px-3 py-2.5 text-left transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-cta">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-secondary">
          Subscribe to reveal your code — it is applied to this order for you.
        </span>
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full bg-cta px-2.5 py-1 text-xs font-semibold text-cta-foreground"
      >
        Get code
      </span>
    </button>
  );
}
