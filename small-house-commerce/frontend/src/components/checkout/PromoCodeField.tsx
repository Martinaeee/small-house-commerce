"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatPrice } from "@/components/ui/PriceBox";

export interface AppliedPromo {
  code: string;
  discountAmount: number;
}

export interface PromoCodeFieldProps {
  /** Cart subtotal the preview is priced against (display only). */
  subtotal: number;
  /** Seeds the input from a code that is already applied in this flow. */
  initialCode?: string;
  onApplied?: (result: AppliedPromo | null) => void;
  /** Lets checkout CTAs stay locked while a preview can still change totals. */
  onCheckingChange?: (checking: boolean) => void;
}

/**
 * The single promo-code entry shared by the cart, both checkout forms and the
 * confirmation step. Applying asks the server to price the code; the amount
 * shown is a preview — the authoritative discount is recomputed when the order
 * is created, and an invalid code clears any earlier discount rather than
 * leaving a stale one on screen.
 */
export function PromoCodeField({
  subtotal,
  initialCode = "",
  onApplied,
  onCheckingChange,
}: PromoCodeFieldProps) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onAppliedRef = useRef(onApplied);
  const onCheckingRef = useRef(onCheckingChange);
  const requestIdRef = useRef(0);
  const lastAttemptedCodeRef = useRef<string | null>(null);
  const seededInitialCodeRef = useRef<string | null>(null);

  useEffect(() => {
    onAppliedRef.current = onApplied;
  }, [onApplied]);

  useEffect(() => {
    onCheckingRef.current = onCheckingChange;
  }, [onCheckingChange]);

  const applyCode = useCallback(
    async (candidate: string) => {
      const trimmed = candidate.trim();
      const requestId = ++requestIdRef.current;
      if (trimmed === "") {
        lastAttemptedCodeRef.current = null;
        setBusy(false);
        setMessage("Enter a code to apply it.");
        onCheckingRef.current?.(false);
        onAppliedRef.current?.(null);
        return;
      }

      lastAttemptedCodeRef.current = trimmed;
      setBusy(true);
      setMessage(null);
      onCheckingRef.current?.(true);
      onAppliedRef.current?.(null);
      try {
        const result = await api.previewPromoCode(trimmed, subtotal);
        if (requestId !== requestIdRef.current) return;
        if (result.valid) {
          setMessage(
            `Promo code applied — you save ${formatPrice(result.discountAmount)}.`,
          );
          onAppliedRef.current?.({
            code: trimmed.toUpperCase(),
            discountAmount: result.discountAmount,
          });
        } else {
          setMessage(result.message || "That promo code isn't valid.");
          onAppliedRef.current?.(null);
        }
      } catch {
        if (requestId !== requestIdRef.current) return;
        setMessage("We could not check that code. Please try again.");
        onAppliedRef.current?.(null);
      } finally {
        if (requestId === requestIdRef.current) {
          setBusy(false);
          onCheckingRef.current?.(false);
        }
      }
    },
    [subtotal],
  );

  useEffect(() => {
    let alive = true;
    const seedChanged = seededInitialCodeRef.current !== initialCode;
    if (seedChanged) {
      requestIdRef.current += 1;
      lastAttemptedCodeRef.current = null;
    }
    const requestIdAtStart = requestIdRef.current;

    void (async () => {
      await Promise.resolve();
      if (!alive || requestIdRef.current !== requestIdAtStart) return;
      if (seedChanged) {
        seededInitialCodeRef.current = initialCode;
        setCode(initialCode);
        setMessage(null);
        setBusy(false);
        onCheckingRef.current?.(false);
        onAppliedRef.current?.(null);
        if (initialCode.trim() !== "") {
          await applyCode(initialCode);
        }
        return;
      }

      // A subtotal change invalidates the amount but not the shopper's code.
      // Recheck the last attempted code without resetting the visible input.
      if (lastAttemptedCodeRef.current) {
        await applyCode(lastAttemptedCodeRef.current);
      }
    })();
    return () => {
      alive = false;
      requestIdRef.current += 1;
    };
  }, [applyCode, initialCode]);

  function handleCodeChange(value: string): void {
    // A shopper edit wins over a deferred initial seed. Mark the current prop as
    // consumed so a later subtotal rerender cannot restore over their input.
    seededInitialCodeRef.current = initialCode;
    requestIdRef.current += 1;
    lastAttemptedCodeRef.current = null;
    setCode(value);
    setMessage(null);
    setBusy(false);
    onCheckingRef.current?.(false);
    onAppliedRef.current?.(null);
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setMessage(null);
        }}
        className="text-sm text-cta hover:underline"
        aria-expanded={open}
      >
        {open ? "Hide promo code" : "Have a promo code?"}
      </button>
      {open && (
        <div className="mt-2 flex gap-2">
          <input
            value={code}
            onChange={(event) => handleCodeChange(event.target.value)}
            placeholder="Enter code"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
            aria-label="Promo code"
          />
          <button
            type="button"
            onClick={() => {
              void applyCode(code);
            }}
            disabled={busy}
            className="shrink-0 rounded-lg border border-cta/40 px-4 text-sm font-medium text-cta hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:text-ink-muted"
          >
            {busy ? "Checking…" : "Apply"}
          </button>
        </div>
      )}
      {message && (
        <p
          data-testid="promo-code-message"
          className="mt-2 text-xs text-ink-muted"
        >
          {message}
        </p>
      )}
    </div>
  );
}
