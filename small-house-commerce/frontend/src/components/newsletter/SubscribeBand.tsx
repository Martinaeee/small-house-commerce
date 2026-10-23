"use client";

import { useState } from "react";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { SubscribeEmailForm } from "./SubscribeEmailForm";
import { NewsletterSuccessDialog } from "./NewsletterSuccessDialog";

const POPUP_SEEN_KEY = "luwag_newsletter_popup_seen";

/**
 * The newsletter band that sits above the footer rows: a sage strip with the
 * headline on the left and the subscribe field on the right (centered and
 * stacked on phones). The offer copy is shown only while a promotion is
 * actually live (`newsletterOfferAvailable` is computed server-side); with no
 * live promotion this degrades to the standing line instead of promising a
 * discount that does not exist.
 */
export function SubscribeBand({
  mode = "live",
}: {
  mode?: "live" | "preview";
}) {
  const settings = useSiteSettings();
  const preview = mode === "preview";
  const [successCode, setSuccessCode] = useState<string | null | undefined>(
    undefined,
  );
  if (!settings.newsletterBandEnabled) return null;

  const showOffer =
    settings.newsletterOfferAvailable &&
    (settings.newsletterOfferTitle !== "" || settings.newsletterOfferBody !== "");

  return (
    <>
      <section
        data-testid="newsletter-band"
        className="bg-footer-band text-footer-band-ink"
      >
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-5 px-4 py-7 text-center sm:px-6 lg:flex-row lg:justify-between lg:gap-10 lg:py-8 lg:text-left">
          <div
            data-testid={showOffer ? "newsletter-band-offer" : undefined}
            className="min-w-0"
          >
            {settings.newsletterEyebrow ? (
              <p
                data-testid="newsletter-eyebrow"
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-footer-band-soft"
              >
                {settings.newsletterEyebrow}
              </p>
            ) : null}
            <h2 className="mt-1.5 text-[19px] font-bold uppercase leading-[1.2] tracking-[-0.01em] lg:text-[23px]">
              {showOffer && settings.newsletterOfferTitle
                ? settings.newsletterOfferTitle
                : "Make more room for good ideas"}
            </h2>
            <p className="mt-1.5 max-w-[46ch] text-[12.5px] leading-5 text-footer-band-soft lg:text-[13px]">
              {showOffer && settings.newsletterOfferBody
                ? settings.newsletterOfferBody
                : "New arrivals, home ideas and special offers — straight to your inbox."}
            </p>
          </div>
          <div className="w-full max-w-[340px]">
            <p data-testid="newsletter-form-title" className="sr-only">
              {settings.newsletterFormTitle}
            </p>
            <SubscribeEmailForm
              source="FOOTER"
              variant="footer-pill"
              placeholder={settings.newsletterEmailPlaceholder}
              disabled={preview}
              onSuccess={(promoCode) => {
                try {
                  window.localStorage.setItem(POPUP_SEEN_KEY, "1");
                } catch {
                  // Storage unavailable: the subscription itself still stands.
                }
                setSuccessCode(promoCode);
              }}
            />
            <p className="mt-2 text-[10px] leading-4 text-footer-band-soft">
              {settings.newsletterConsentText}
            </p>
          </div>
        </div>
      </section>
      {successCode !== undefined ? (
        <NewsletterSuccessDialog
          promoCode={successCode}
          onClose={() => setSuccessCode(undefined)}
        />
      ) : null}
    </>
  );
}
