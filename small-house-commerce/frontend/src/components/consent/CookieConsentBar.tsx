"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  onConsentOpen,
  readConsentChoice,
  saveConsentChoice,
  type ConsentChoice,
} from "@/lib/consent";

/**
 * Bottom consent bar for optional advertising cookies. It never blocks the
 * page, sits above the mobile tab bar, and only leaves after a choice — the
 * footer's "Cookie Settings" reopens it later.
 */
export function CookieConsentBar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Deferred so the effect body does not set state synchronously; a decision
    // already stored simply keeps the bar closed.
    const initial = window.setTimeout(() => {
      if (readConsentChoice() === null) setOpen(true);
    }, 0);
    const off = onConsentOpen(() => setOpen(true));
    return () => {
      window.clearTimeout(initial);
      off();
    };
  }, []);

  function choose(choice: ConsentChoice) {
    saveConsentChoice(choice);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="region"
      aria-label="Your privacy choices"
      className="fixed inset-x-0 bottom-[var(--mobile-tab-bar-offset,0px)] z-40 border-t border-border bg-card px-4 py-3 shadow-[0_-6px_20px_rgba(31,42,36,0.08)] md:bottom-0"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-[13px] leading-5 text-ink-secondary">
          We use optional cookies to measure ads and improve LUWAG. You can
          accept all cookies or keep only those the site needs to work.{" "}
          <Link
            href="/privacy"
            className="text-cta underline underline-offset-2 hover:text-cta-hover"
          >
            Privacy Policy
          </Link>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-ink transition hover:border-cta"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-cta px-4 text-sm font-semibold text-cta-foreground transition hover:bg-cta-hover"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
