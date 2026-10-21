"use client";

import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { requestNewsletterOffer } from "./newsletterOfferChannel";

/**
 * The subscriber offer inside the checkout totals. It opens the subscribe
 * popup on demand — a shopper who taps it gets the code, and the code is put
 * on the running total by the promo field. The copy comes from the storefront
 * settings and only renders while the server reports a live promotion.
 */
export function NewsletterOfferPrompt() {
  const settings = useSiteSettings();
  const title =
    typeof settings.newsletterOfferTitle === "string"
      ? settings.newsletterOfferTitle.trim()
      : "";
  if (!settings.newsletterOfferAvailable || title === "") return null;

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
