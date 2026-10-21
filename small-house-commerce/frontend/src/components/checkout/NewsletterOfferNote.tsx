"use client";

import { useSiteSettings } from "@/components/site/SiteSettingsProvider";

/**
 * The subscriber offer shown next to the promo-code entry. The copy comes from
 * the storefront settings and only renders while the server reports a live
 * promotion (`newsletterOfferAvailable`), so the line never promises a code the
 * backend would reject.
 */
export function NewsletterOfferNote() {
  const settings = useSiteSettings();
  const title =
    typeof settings.newsletterOfferTitle === "string"
      ? settings.newsletterOfferTitle.trim()
      : "";
  if (!settings.newsletterOfferAvailable || title === "") return null;
  return (
    <p
      data-testid="newsletter-offer-note"
      className="mt-2 text-xs leading-relaxed text-ink-secondary"
    >
      {title}
    </p>
  );
}
