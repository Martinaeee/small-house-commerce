"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrandWordmark } from "@/components/layout/BrandWordmark";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { SubscribeEmailForm } from "./SubscribeEmailForm";
import { NewsletterSuccessDialog } from "./NewsletterSuccessDialog";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2f211b]/60 px-3 py-5 backdrop-blur-[2px] sm:px-4"
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
        className="relative max-h-[calc(100dvh-2rem)] w-[min(94vw,25rem)] overflow-x-hidden overflow-y-auto rounded-[1.75rem] border border-white/70 bg-[#fff4ed] shadow-[0_28px_80px_rgba(45,29,22,0.35)]"
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
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-[#765f54] transition hover:bg-white/70 hover:text-[#33251f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a85238] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff4ed]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>

        <div className="relative px-5 pb-6 pt-6 text-center sm:px-7 sm:pb-7">
          <div className="flex justify-center">
            <BrandWordmark className="text-lg text-[#704632]" />
          </div>

          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#a7654b]">
            {settings.newsletterEyebrow}
          </p>

          <h2
            id="newsletter-popup-title"
            className="mt-2 text-[1.7rem] font-semibold leading-tight tracking-[-0.03em] text-[#2f241f]"
          >
            {settings.newsletterFormTitle}
          </h2>

          <p className="mx-auto mt-2 max-w-[19rem] text-sm leading-6 text-[#735f54]">
            {settings.newsletterOfferBody ||
              "Get first access to new pieces and subscriber-only offers."}
          </p>

          <div
            data-testid="newsletter-offer-ticket"
            className="relative mx-auto mt-5 overflow-hidden rounded-2xl border border-[#edcdbf] bg-white px-6 py-5 shadow-[0_14px_34px_rgba(90,54,37,0.11)] before:absolute before:-left-3 before:top-1/2 before:h-6 before:w-6 before:-translate-y-1/2 before:rounded-full before:bg-[#fff4ed] after:absolute after:-right-3 after:top-1/2 after:h-6 after:w-6 after:-translate-y-1/2 after:rounded-full after:bg-[#fff4ed]"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#a36a52]">
              One real checkout offer
            </p>
            <p className="mt-2 break-words text-2xl font-bold leading-tight tracking-[-0.03em] text-[#c35439]">
              {offerTitle}
            </p>
            <div className="mx-auto mt-4 w-4/5 border-t border-dashed border-[#e5c3b4]" />
            <p className="mt-3 text-xs text-[#80675b]">
              Subscribe to reveal your code
            </p>
          </div>

          <div className="mt-5">
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

          <p className="mx-auto mt-4 max-w-[20rem] text-[10px] leading-4 text-[#8d786d]">
            {settings.newsletterConsentText}
          </p>
        </div>
      </div>
    </div>
  );
}
