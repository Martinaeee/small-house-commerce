"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrandWordmark } from "@/components/layout/BrandWordmark";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { SubscribeEmailForm } from "./SubscribeEmailForm";
import { NewsletterSuccessDialog } from "./NewsletterSuccessDialog";
import { onNewsletterOfferRequest } from "./newsletterOfferChannel";

const SEEN_KEY = "luwag_newsletter_popup_seen";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * First-visit subscribe popup. Opens once per browser, after the configured
 * delay, and only while a promotion is actually live — with no live promotion
 * there is no offer to promise, so it never opens. Closing it or subscribing
 * records the seen key so a reload stays quiet.
 */
export function NewsletterPopup() {
  const settings = useSiteSettings();
  const eligible =
    settings.newsletterPopupEnabled && settings.newsletterOfferAvailable;
  const [open, setOpen] = useState(false);
  const [successCode, setSuccessCode] = useState<string | null | undefined>(
    undefined,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private mode: the popup simply reappears next visit.
    }
  }, []);

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [markSeen]);

  useEffect(() => {
    if (!eligible) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) !== null;
    } catch {
      seen = false;
    }
    if (seen) return;

    timerRef.current = setTimeout(() => {
      try {
        if (window.localStorage.getItem(SEEN_KEY) !== null) return;
      } catch {
        // Storage unavailable: keep the current visit eligible.
      }
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOpen(true);
    }, Math.max(0, settings.newsletterPopupDelaySeconds) * 1000);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [eligible, settings.newsletterPopupDelaySeconds]);

  // On-demand open: the shopper tapped the offer line somewhere on the page
  // (the checkout totals), so the popup opens right away — the first-visit
  // timer and the seen key do not apply to a deliberate request.
  useEffect(() => {
    if (!settings.newsletterOfferAvailable) return;
    return onNewsletterOfferRequest(() => {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOpen(true);
    });
  }, [settings.newsletterOfferAvailable]);

  // Scroll lock, initial focus, focus trap, Escape, focus restoration.
  useEffect(() => {
    if (!open || successCode !== undefined) return;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, close, successCode]);

  if (!open) return null;
  if (successCode !== undefined) {
    return <NewsletterSuccessDialog promoCode={successCode} onClose={close} />;
  }

  const offerTitle = settings.newsletterOfferTitle || "A welcome offer";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-3 py-5 backdrop-blur-[2px] sm:px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        data-testid="newsletter-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newsletter-popup-title"
        className="relative max-h-[min(56dvh,26rem)] w-[min(82vw,20rem)] overflow-x-hidden overflow-y-auto rounded-[1.5rem] border border-white/70 bg-newsletter-surface shadow-[0_28px_80px_rgba(45,29,22,0.35)] sm:max-h-[calc(100dvh-2rem)] sm:w-[min(94vw,25rem)] sm:rounded-[1.75rem]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(196,101,70,.18) 0 2px, transparent 2.5px), radial-gradient(circle at 88% 22%, rgba(112,70,50,.13) 0 3px, transparent 3.5px), radial-gradient(circle at 72% 72%, rgba(196,101,70,.12) 0 2px, transparent 2.5px), linear-gradient(145deg, rgba(255,255,255,.75), rgba(249,220,205,.45))",
            backgroundSize: "58px 58px, 86px 86px, 72px 72px, 100% 100%",
          }}
        />

        <button
          type="button"
          data-testid="newsletter-popup-close"
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-newsletter-muted transition hover:bg-white/70 hover:text-newsletter-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-newsletter-accent focus-visible:ring-offset-2 focus-visible:ring-offset-newsletter-surface"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>

        <div className="relative px-4 pb-5 pt-5 text-center sm:px-7 sm:pb-7 sm:pt-6">
          <div className="flex justify-center">
            <BrandWordmark className="text-base text-cta sm:text-lg" />
          </div>

          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-newsletter-accent sm:mt-5">
            {settings.newsletterEyebrow}
          </p>

          <h2
            id="newsletter-popup-title"
            className="mt-1.5 text-[1.32rem] font-semibold leading-tight tracking-[-0.03em] text-newsletter-text sm:mt-2 sm:text-[1.7rem]"
          >
            {settings.newsletterFormTitle}
          </h2>

          <p className="mx-auto mt-1.5 hidden max-w-[19rem] text-newsletter-secondary sm:mt-2 sm:block sm:text-sm sm:leading-6">
            {settings.newsletterOfferBody ||
              "Get first access to new pieces and subscriber-only offers."}
          </p>

          <div
            data-testid="newsletter-offer-ticket"
            className="relative mx-auto mt-3.5 overflow-hidden rounded-2xl border border-newsletter-border bg-white px-4 py-4 shadow-[0_14px_34px_rgba(90,54,37,0.11)] before:absolute before:-left-3 before:top-1/2 before:h-6 before:w-6 before:-translate-y-1/2 before:rounded-full before:bg-newsletter-surface after:absolute after:-right-3 after:top-1/2 after:h-6 after:w-6 after:-translate-y-1/2 after:rounded-full after:bg-newsletter-surface sm:mt-5 sm:px-6 sm:py-5"
          >
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.22em] text-newsletter-accent sm:block">
              One real checkout offer
            </p>
            <p className="break-words text-xl font-bold leading-tight tracking-[-0.03em] text-newsletter-accent sm:mt-2 sm:text-2xl">
              {offerTitle}
            </p>
            <div className="mx-auto mt-2.5 w-4/5 border-t border-dashed border-newsletter-border sm:mt-4" />
            <p className="mt-2 text-xs text-newsletter-secondary sm:mt-3">
              Subscribe to reveal your code
            </p>
          </div>

          <div className="mt-3.5 sm:mt-5">
            <SubscribeEmailForm
              source="POPUP"
              variant="popup"
              placeholder={settings.newsletterEmailPlaceholder}
              onSuccess={(promoCode) => {
                markSeen();
                setSuccessCode(promoCode);
              }}
            />
          </div>

          <p className="mx-auto mt-3 max-w-[20rem] text-[10px] leading-4 text-newsletter-muted sm:mt-4">
            {settings.newsletterConsentText}
          </p>
        </div>
      </div>
    </div>
  );
}
