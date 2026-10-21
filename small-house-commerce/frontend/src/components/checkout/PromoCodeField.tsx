"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatPrice } from "@/components/ui/PriceBox";
import {
  onNewsletterCodeGranted,
  readStoredNewsletterCode,
} from "@/components/newsletter/newsletterOfferChannel";

export interface AppliedPromo {
  code: string;
  discountAmount: number;
}

/**
 * Where a code came from. A code the shopper typed always outranks a code a
 * subscription revealed — they typed it on purpose, we handed them theirs.
 */
type CodeSource = "shopper" | "granted";

/** How the shopper's own code stands: typed, being priced, working or dead. */
type ShopperCodeState = "none" | "typed" | "pending" | "valid" | "invalid";

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
 *
 * A code a subscription revealed is put on the total without the shopper
 * typing it: one revealed on this page, or one revealed earlier (it is kept
 * in local storage until the order is placed).
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
  // A code revealed by an earlier subscription, read once after mount.
  const [storedCode, setStoredCode] = useState<string | null>(null);
  // The code the flow starts with: the shopper's own code wins over one a
  // subscription revealed.
  const hasFlowCode = initialCode.trim() !== "";
  const effectiveSeed = hasFlowCode ? initialCode : (storedCode ?? "");
  const seedSource: CodeSource = hasFlowCode ? "shopper" : "granted";
  const onAppliedRef = useRef(onApplied);
  const onCheckingRef = useRef(onCheckingChange);
  const requestIdRef = useRef(0);
  const lastAttemptedCodeRef = useRef<string | null>(null);
  const lastSourceRef = useRef<CodeSource>("granted");
  const seededInitialCodeRef = useRef<string | null>(null);
  const shopperCodeRef = useRef<string | null>(null);
  const shopperStateRef = useRef<ShopperCodeState>("none");
  const applyCodeRef = useRef<
    (candidate: string, source?: CodeSource) => Promise<void>
  >(async () => {});

  useEffect(() => {
    onAppliedRef.current = onApplied;
  }, [onApplied]);

  useEffect(() => {
    onCheckingRef.current = onCheckingChange;
  }, [onCheckingChange]);

  const applyCode = useCallback(
    async (candidate: string, source: CodeSource = "shopper") => {
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
      lastSourceRef.current = source;
      if (source === "shopper") {
        shopperCodeRef.current = trimmed;
        shopperStateRef.current = "pending";
      }
      setBusy(true);
      setMessage(null);
      onCheckingRef.current?.(true);
      onAppliedRef.current?.(null);
      try {
        const result = await api.previewPromoCode(trimmed, subtotal);
        if (requestId !== requestIdRef.current) return;
        if (result.valid) {
          if (source === "shopper") shopperStateRef.current = "valid";
          setMessage(
            `Promo code applied — you save ${formatPrice(result.discountAmount)}.`,
          );
          onAppliedRef.current?.({
            code: trimmed.toUpperCase(),
            discountAmount: result.discountAmount,
          });
        } else {
          if (source === "shopper") shopperStateRef.current = "invalid";
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
    const seedChanged = seededInitialCodeRef.current !== effectiveSeed;
    if (seedChanged) {
      requestIdRef.current += 1;
      lastAttemptedCodeRef.current = null;
    }
    const requestIdAtStart = requestIdRef.current;

    void (async () => {
      await Promise.resolve();
      if (!alive || requestIdRef.current !== requestIdAtStart) return;
      if (seedChanged) {
        seededInitialCodeRef.current = effectiveSeed;
        setCode(effectiveSeed);
        // A code we revealed is shown in the open field: the shopper can see
        // which code is on their total.
        if (seedSource === "granted" && effectiveSeed.trim() !== "") {
          setOpen(true);
        }
        setMessage(null);
        setBusy(false);
        onCheckingRef.current?.(false);
        onAppliedRef.current?.(null);
        if (effectiveSeed.trim() !== "") {
          await applyCode(effectiveSeed, seedSource);
        }
        return;
      }

      // A subtotal change invalidates the amount but not the shopper's code.
      // Recheck the last attempted code without resetting the visible input.
      if (lastAttemptedCodeRef.current) {
        await applyCode(lastAttemptedCodeRef.current, lastSourceRef.current);
      }
    })();
    return () => {
      alive = false;
      requestIdRef.current += 1;
    };
  }, [applyCode, effectiveSeed, seedSource]);

  useEffect(() => {
    applyCodeRef.current = applyCode;
  }, [applyCode]);

  // A code revealed by an earlier subscription is put on the running total
  // without the shopper typing it in. It is read after mount so the server
  // render stays free of browser-only storage.
  useEffect(() => {
    const stored = readStoredNewsletterCode();
    if (!stored) return;
    let alive = true;
    void (async () => {
      // The await keeps the setState out of the effect's synchronous body
      // (react-hooks/set-state-in-effect; same convention as
      // AuthProvider/CartContext/CheckoutConfirmView).
      await Promise.resolve();
      if (!alive) return;
      setStoredCode(stored);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return onNewsletterCodeGranted((granted) => {
      // A code the shopper typed wins over one we revealed — unless their own
      // code turned out to be invalid, in which case theirs takes over.
      const state = shopperStateRef.current;
      if (shopperCodeRef.current !== null && state !== "invalid") return;
      shopperCodeRef.current = null;
      shopperStateRef.current = "none";
      setCode(granted);
      setOpen(true);
      void applyCodeRef.current(granted, "granted");
    });
  }, []);

  function handleCodeChange(value: string): void {
    // A shopper edit wins over a deferred initial seed. Mark the current prop as
    // consumed so a later subtotal rerender cannot restore over their input.
    seededInitialCodeRef.current = effectiveSeed;
    requestIdRef.current += 1;
    lastAttemptedCodeRef.current = null;
    const trimmed = value.trim();
    shopperCodeRef.current = trimmed === "" ? null : value;
    shopperStateRef.current = trimmed === "" ? "none" : "typed";
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
