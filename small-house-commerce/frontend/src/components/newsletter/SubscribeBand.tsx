"use client";

import { useState } from "react";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { SubscribeEmailForm } from "./SubscribeEmailForm";
import { NewsletterSuccessDialog } from "./NewsletterSuccessDialog";

const POPUP_SEEN_KEY = "luwag_newsletter_popup_seen";

/**
 * Subscribe block rendered as the footer's own column (Castlery pattern): the
 * footer is one continuous warm-brown surface, so this is a plain grid cell
 * rather than a separate band stacked above a white footer.
 *
 * The offer copy is shown only while a promotion is actually live
 * (`newsletterOfferAvailable` is computed server-side); with no live promotion
 * this degrades to a plain subscribe box rather than promising a discount that
 * does not exist.
 */
export function SubscribeBand() {
  const settings = useSiteSettings();
  const [successCode, setSuccessCode] = useState<string | null | undefined>(
    undefined,
  );
  if (!settings.newsletterBandEnabled) return null;

  const showOffer =
    settings.newsletterOfferAvailable &&
    (settings.newsletterOfferTitle !== "" || settings.newsletterOfferBody !== "");

  return (
    <>
      <div data-testid="newsletter-band" className="min-w-0">
        <div data-testid={showOffer ? "newsletter-band-offer" : undefined}>
          <p className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-footer-muted">
            <span className="h-px w-8 bg-footer-muted" aria-hidden="true" />
            {showOffer ? "Subscriber welcome offer" : "The LUWAG edit"}
          </p>
          <h2 className="mt-2.5 max-w-[24rem] font-serif text-2xl leading-[1.12] tracking-[-0.02em] text-footer-foreground sm:text-[1.75rem]">
            {showOffer && settings.newsletterOfferTitle
              ? settings.newsletterOfferTitle
              : "Make more room for good ideas"}
          </h2>
          <p className="mt-2 max-w-[26rem] text-sm leading-6 text-footer-secondary">
            {showOffer && settings.newsletterOfferBody
              ? settings.newsletterOfferBody
              : "New furniture, small-space inspiration and subscriber-only updates, sent occasionally."}
          </p>
        </div>

        <div className="mt-5">
          <SubscribeEmailForm
            source="FOOTER"
            variant="band"
            onSuccess={(promoCode) => {
              try {
                window.localStorage.setItem(POPUP_SEEN_KEY, "1");
              } catch {
                // Storage unavailable: the subscription itself still stands.
              }
              setSuccessCode(promoCode);
            }}
          />
          <p className="mt-2 max-w-[26rem] text-[10px] leading-4 text-footer-muted">
            By subscribing, you agree to receive LUWAG offers and updates.
            Unsubscribe anytime.
          </p>
        </div>
      </div>
      {successCode !== undefined ? (
        <NewsletterSuccessDialog
          promoCode={successCode}
          onClose={() => setSuccessCode(undefined)}
        />
      ) : null}
    </>
  );
}
