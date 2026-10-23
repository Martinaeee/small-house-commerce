"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function NewsletterSuccessDialog({
  promoCode,
  onClose,
}: {
  promoCode: string | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
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
  }, [onClose]);

  async function copyCode() {
    if (!promoCode) return;
    setCopied(await copyText(promoCode));
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 px-3 py-5 backdrop-blur-[2px] sm:px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-testid="newsletter-success-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newsletter-success-title"
        className="relative max-h-[calc(100dvh-2rem)] w-[min(94vw,30rem)] overflow-x-hidden overflow-y-auto border border-newsletter-border border-t-[7px] border-t-cta bg-newsletter-surface-alt px-5 pb-5 pt-7 text-center shadow-[0_28px_80px_rgba(45,29,22,0.35)] sm:px-7 sm:pb-6 sm:pt-8"
      >
        <button
          type="button"
          aria-label="Close success message"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center text-newsletter-text transition hover:text-newsletter-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-newsletter-accent sm:right-4 sm:top-3"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M5 5l14 14M19 5 5 19" strokeLinecap="round" />
          </svg>
        </button>

        <div className="flex items-center justify-center gap-3 pr-8 sm:gap-4 sm:pr-0">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-cta text-cta" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2
            id="newsletter-success-title"
            className="font-serif text-3xl leading-none tracking-[-0.03em] text-newsletter-text sm:text-[2.5rem]"
          >
            Thank You!
          </h2>
        </div>

        <p className="mt-4 text-sm leading-6 text-newsletter-secondary sm:text-base">
          You have successfully subscribed to the newsletter.
        </p>

        {promoCode ? (
          <div className="relative mx-auto mt-5 max-w-md overflow-hidden rounded-2xl border border-newsletter-border bg-white px-4 py-3 shadow-[0_10px_28px_rgba(91,55,38,0.08)] before:absolute before:-left-3 before:top-1/2 before:h-6 before:w-6 before:-translate-y-1/2 before:rounded-full before:bg-newsletter-surface-alt after:absolute after:-right-3 after:top-1/2 after:h-6 after:w-6 after:-translate-y-1/2 after:rounded-full after:bg-newsletter-surface-alt">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-newsletter-accent">
              Your checkout code
            </p>
            <code className="mt-1 block break-all font-mono text-xl font-bold tracking-[0.12em] text-newsletter-ticket" data-testid="newsletter-subscribe-code">
              {promoCode}
            </code>
            <button
              type="button"
              data-testid="newsletter-copy-code"
              onClick={() => {
                void copyCode();
              }}
              className="mt-2 border-b border-cta pb-0.5 text-sm font-semibold text-cta transition hover:text-newsletter-accent"
            >
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        ) : null}

        <button
          type="button"
          data-autofocus
          onClick={onClose}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-newsletter-accent px-6 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-newsletter-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-newsletter-accent focus-visible:ring-offset-2"
        >
          Close
        </button>
      </div>
    </div>
  );
}
