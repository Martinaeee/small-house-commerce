"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface ToastProps {
  /** The message to show. Nothing renders when this is null. */
  message: string | null;
  /** Called when the toast times out or the shopper dismisses it. */
  onDismiss(): void;
  /** How long the message stays on screen. */
  durationMs?: number;
}

/**
 * A single, quiet confirmation for the storefront.
 *
 * It sits above the fixed purchase bar (the bar publishes its height as
 * --sticky-bar-offset) so the two never overlap on a phone.
 */
export function Toast({
  message,
  onDismiss,
  durationMs = 4000,
}: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, message, onDismiss]);

  if (!message) return null;

  // Portalled to the body: a card or section may clip or transform its
  // children, which would move a fixed toast with it.
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="storefront-toast"
      className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4"
      style={{
        // Above the fixed purchase bar and the mobile tab bar when either is
        // on screen.
        bottom:
          "calc(var(--sticky-bar-offset, 0px) + var(--mobile-tab-bar-offset, 0px) + 1rem)",
      }}
    >
      <p className="pointer-events-auto flex max-w-[min(92vw,28rem)] items-start gap-3 rounded-xl border border-border bg-ink px-4 py-3 text-sm font-medium text-card shadow-lg">
        <span className="flex-1">{message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-base text-card/70 transition hover:bg-card/10 hover:text-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-card"
        >
          ✕
        </button>
      </p>
    </div>,
    document.body,
  );
}
