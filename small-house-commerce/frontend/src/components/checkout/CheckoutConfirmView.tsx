"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, ApiTimeoutError } from "@/lib/api";
import { deliveryWindowFor } from "@/lib/deliveryWindow";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { useCart } from "@/components/cart/CartContext";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { recordSupportOrderCompleted } from "@/components/chat/mobile-support-reminder";
import { readAttribution } from "@/lib/tracking";
import { analyticsSessionId } from "@/lib/analytics";
import { recordSubmitAttempt, recordSubmitFailure, checkoutFailureReason, clearSubmitAttempt } from "@/lib/checkout-events";
import { purchaseEvent, storePurchasePayload } from "@/lib/commerce-events";
import { hasAdsConsent } from "@/lib/consent";
import { readMetaBrowserIds } from "@/lib/meta-capi";
import { validateCheckoutForm } from "@/lib/checkoutValidation";
import {
  checkoutIdempotencyAttempt,
  clearCheckoutIdempotencyKey,
  clearCompletedCheckout,
  findCompletedCheckout,
  recordCompletedCheckout,
} from "@/lib/checkout-idempotency";
import {
  ATTEMPT_POLL_INTERVAL_MS,
  beginCheckoutSubmission,
  clearCheckoutSubmission,
  markCheckoutSubmissionOrdered,
  PLACE_ORDER_RECOVERY_WINDOW_MS,
  readCheckoutSubmission,
  type CheckoutSubmission,
} from "@/lib/checkout-submission";
import {
  checkoutDraftStorageBlocked,
  readCheckoutDraft,
  clearCheckoutDraft,
  type CheckoutDraft,
} from "@/lib/checkoutDraft";
import {
  autosaveStatusLabel,
  buildCheckoutSnapshot,
  checkoutAttemptKey,
  clearAutosave,
  readCheckoutAttemptToken,
  resolveCheckoutAttempt,
} from "@/lib/checkoutAutosave";
import { useCheckoutDraftAutosave } from "./useCheckoutDraftAutosave";
import { useCheckoutLines } from "./useCheckoutLines";
import { PromoCodeField, type AppliedPromo } from "./PromoCodeField";
import { NewsletterOfferPrompt } from "@/components/newsletter/NewsletterOfferPrompt";
import { clearStoredNewsletterCode } from "@/components/newsletter/newsletterOfferChannel";

import { OrderPreview } from "./OrderPreview";
import { CheckoutTrustStrip } from "./CheckoutTrustStrip";
import { checkoutQueryString } from "./checkoutItems";

/**
 * COD review step (design spec §3.4): the form page validates and stashes the
 * customer in sessionStorage, then pushes here. With no draft (or an invalid
 * one, e.g. storage unavailable) we replace back to the form so the standalone
 * route can never dead-end. PLACE COD ORDER submits the same payload the
 * single-step flow used to; on success the draft is cleared alongside the
 * existing cart-line removal and total stash.
 */

/**
 * Format an ISO yyyy-MM-dd value as "Oct 3, 2026" in Asia/Manila. The stored
 * convention is UTC midnight (spec §3.2, ruling D-1), so formatting with the
 * Manila zone renders the same calendar day the buyer picked.
 */
const CART_CLEANUP_ATTEMPTS = 3;
const CART_CLEANUP_DELAY_MS = [200, 400];

/**
 * F02: cart cleanup after a confirmed order is best effort. Each attempt
 * removes the remaining lines (a 404 counts as already removed inside
 * CartContext), and a short backoff covers a blip without ever blocking the
 * success page. After the last attempt the stale cart is left as-is.
 */
async function cleanupCartInBackground(
  remove: (itemIds: readonly string[]) => Promise<unknown>,
  itemIds: readonly string[],
  onCleaned?: () => void,
): Promise<void> {
  for (let attempt = 0; attempt < CART_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await remove(itemIds);
      // The cart is empty, so this confirmation URL is spent; a later
      // purchase needs a new scope, not the completed-order redirect.
      onCleaned?.();
      return;
    } catch {
      if (attempt < CART_CLEANUP_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, CART_CLEANUP_DELAY_MS[attempt] ?? 400),
        );
      }
    }
  }
}
function formatPreferredDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

interface CheckoutConfirmViewProps {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
  /**
   * `auto=1` (set by the checkout form's PLACE ORDER): the address and the
   * summary were already reviewed on the form, so this page places the order
   * itself on arrival instead of asking the shopper to confirm again.
   */
  autoPlace?: boolean;
}

type CheckoutPayload = Parameters<typeof api.createOrder>[0];

/**
 * F04 submission states. SUBMITTING is "we sent it and are waiting"; after
 * the response budget it becomes CONFIRMING while the page polls the attempt;
 * UNKNOWN means the recovery window also passed and only the shopper can ask
 * again. A timeout is never a failure: no state here claims the order did not
 * happen, and the same key/payload is kept for every retry.
 */
type SubmissionPhase = "IDLE" | "SUBMITTING" | "CONFIRMING" | "UNKNOWN";

/**
 * Which failures leave the outcome genuinely unknown (the request may have
 * created an order even though the browser saw an error). Only a 4xx answer
 * from our own backend proves no order was created for this attempt.
 */
function outcomeIsUnknown(error: unknown): boolean {
  if (error instanceof ApiTimeoutError) return true;
  // Offline, DNS or a dropped connection: the request may or may not have
  // arrived.
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof ApiError) {
    // Server/proxy errors can happen after the transaction committed.
    return error.status >= 500 || error.status === 409;
  }
  return false;
}

/**
 * Redacted local diagnostic for an unknown outcome: no address, phone,
 * cookie or recovery key — just why the result could not be read. A server
 * analytics event would need a new persisted event name (Prisma enum migration,
 * separately approved), so this stays in the browser console for now.
 */
function logUnknownOutcome(error: unknown): void {
  try {
    const kind =
      error instanceof ApiTimeoutError
        ? "TIMEOUT"
        : error instanceof TypeError
          ? "NETWORK"
          : error instanceof ApiError && error.status >= 500
            ? "SERVER"
            : "UNKNOWN";
    const httpStatus = error instanceof ApiError ? error.status : null;
    console.warn("[checkout] order outcome unknown", { kind, httpStatus });
  } catch {
    /* logging never breaks checkout */
  }
}

function editHrefForDraft(draft: CheckoutDraft | null, checkoutHref: string): string {
  const selection = draft?.selection;
  if (selection?.kind === "PDP_INLINE") {
    return `/products/${encodeURIComponent(selection.productSlug)}${
      selection.productQuery ?? ""
    }#quick-cod-order`;
  }
  return checkoutHref;
}

export function CheckoutConfirmView({
  skuId,
  qty,
  itemsParam,
  slug,
  autoPlace = false,
}: CheckoutConfirmViewProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<CheckoutDraft | null>(null);
  const [draftUnavailable, setDraftUnavailable] = useState(false);
  const directSelection =
    draft?.selection?.kind === "PDP_INLINE" ? draft.selection : undefined;
  const checkout = useCheckoutLines({
    skuId,
    qty,
    itemsParam,
    slug,
    directItems: directSelection?.items,
    directSlug: directSelection?.productSlug,
  });
  const { removeItems } = useCart();
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();
  // Checkout lines carry their own enriched thumbnails (cart summary data /
  // Buy Now product cover) — no product-by-slug image recovery here either.
  const [phase, setPhase] = useState<SubmissionPhase>("IDLE");
  const inFlightRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryDeadlineRef = useRef<number>(0);
  const aliveRef = useRef(true);
  // Stable across retries of this checkout; the backend replays the original
  // order instead of creating a second one. The consent snapshot belongs to
  // that same attempt: a retry cannot acquire a newer consent choice than the
  // request that may already have created the order and CAPI outbox row.
  // Scoped to this checkout URL so another selection cannot inherit either.
  const idempotencyKeyRef = useRef<{
    scope: string;
    key: string;
    metaConsent: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const checkoutHref = `/checkout${checkoutQueryString({
    skuId,
    qty,
    itemsParam,
    slug,
  })}`;
  const attemptKey = useMemo(
    () => checkoutAttemptKey({ skuId, qty, itemsParam, slug }),
    [skuId, qty, itemsParam, slug],
  );
  const checkoutAttempt = useMemo(
    () => resolveCheckoutAttempt(attemptKey),
    [attemptKey],
  );
  const confirmSnapshot = useMemo(
    () =>
      buildCheckoutSnapshot(
        {
          name: draft?.customer.name ?? "",
          phone: draft?.customer.phone ?? "",
          province: draft?.customer.province ?? "",
          city: draft?.customer.city ?? "",
          barangay: draft?.customer.barangay ?? "",
          postalCode: draft?.customer.postalCode ?? "",
          streetAddress: draft?.customer.streetAddress ?? "",
          landmark: draft?.customer.landmark ?? "",
          preferredDeliveryDate: draft?.preferredDeliveryDate ?? "",
          notes: draft?.customerNote ?? "",
        },
        checkout.orderItems,
        {
          input: draft?.promoCode ?? "",
          applied: appliedPromo?.code ?? draft?.promoCode ?? null,
        },
      ),
    [draft, checkout.orderItems, appliedPromo],
  );
  const confirmAutosave = useCheckoutDraftAutosave({
    attempt: checkoutAttempt,
    snapshot: confirmSnapshot,
    active: draft !== null,
    hasUserInput: true,
  });
  const editHref = editHrefForDraft(draft, checkoutHref);
  const discountedTotal =
    checkout.total === null
      ? null
      : Math.max(0, checkout.total - (appliedPromo?.discountAmount ?? 0));

  useEffect(() => {
    let alive = true;
    void (async () => {
      // sessionStorage is browser-only; the await also keeps the setState out
      // of the effect's synchronous body (react-hooks/set-state-in-effect;
      // same convention as AuthProvider/CartContext).
      await Promise.resolve();
      if (!alive) return;
      const d = readCheckoutDraft();
      let invalid = false;
      if (d) {
        try {
          invalid = Object.keys(validateCheckoutForm(d.customer)).length > 0;
        } catch {
          // A structurally corrupt draft (e.g. fields missing/null) must never
          // reject this effect and strand the reviewer on "Loading…" — treat
          // it as invalid and fall back to the form page.
          invalid = true;
        }
      }
      if (!d || invalid) {
        // F05: with sessionStorage denied, a missing draft is a device
        // limitation, not a stale URL. Never bounce the shopper back to an
        // empty form silently; explain and keep them on this step.
        if (!d && checkoutDraftStorageBlocked()) {
          setDraftUnavailable(true);
          return;
        }
        router.replace(editHrefForDraft(d, checkoutHref));
        return;
      }
      setPromoChecking(Boolean(d.promoCode));
      setDraft(d);
      // F04: a reload after a lost response or a timeout resumes the durable
      // attempt. An already-confirmed attempt re-opens its receipt; an
      // unresolved one is polled, never resubmitted with a fresh key.
      const submission = readCheckoutSubmission<CheckoutPayload>(checkoutHref);
      if (submission?.status === "ORDERED" && submission.orderNumber) {
        router.replace(`/order-success/${submission.orderNumber}`);
        return;
      }
      if (submission?.status === "SUBMITTED") {
        idempotencyKeyRef.current = {
          scope: checkoutHref,
          key: submission.idempotencyKey,
          metaConsent: submission.metaConsent,
        };
        startRecovery(submission);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same dead ends the form page enforces, mirrored at the confirmation
  // step: a Buy Now skuId that matches no variant of its product (or failed
  // to load), and a cart selection that is incomplete or unavailable. Such
  // selections are blocked from confirmation entirely.
  const unresolvedSelection =
    checkout.isBuyNow &&
    (checkout.productError ||
      (checkout.product !== null && !checkout.buyNowMatchedSku)) ||
    (!checkout.isBuyNow &&
      !checkout.cartLoading &&
      (checkout.cartBlocked || checkout.orderItems.length === 0));

  // Buy Now cannot be confirmed before its product resolved — the preview
  // would show no line at all (error/mismatch are the dead end above).
  const awaitingBuyNowResolution =
    checkout.isBuyNow && checkout.product === null && !checkout.productError;
  // While the order request or its recovery is in flight the page must not
  // accept another submission or swap to the unavailable-selection screen.
  const busy = phase === "SUBMITTING" || phase === "CONFIRMING";

  function stopPolling() {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  /**
   * One place that ends a confirmed order, whether the answer arrived on the
   * original request or through attempt recovery after a lost response.
   * Buy Now has no cleanup step and keeps meaning "buy this again", so its
   * durable attempt is dropped at once; the cart path keeps the completed
   * markers until the background cleanup actually empties the cart.
   */
  function finishOrder(
    orderNumber: string,
    grandTotal: number,
    items: readonly { skuId: string; quantity: number }[],
    metaConsent: boolean,
  ): void {
    stopPolling();
    inFlightRef.current = false;
    setPhase("IDLE");
    if (!checkout.isBuyNow) recordCompletedCheckout(checkoutHref, orderNumber);
    recordSupportOrderCompleted();
    clearSubmitAttempt();
    markCheckoutSubmissionOrdered(checkoutHref, orderNumber);
    if (checkout.isBuyNow) clearCheckoutSubmission(checkoutHref);
    try {
      // value is the server's authoritative total. Consent rides along so the
      // browser event stays with the choice in force at submit.
      storePurchasePayload(
        purchaseEvent({ orderId: orderNumber, items, value: grandTotal }),
        metaConsent,
      );
      const current = readCheckoutDraft();
      sessionStorage.setItem(
        "lastPreferredDate",
        current?.preferredDeliveryDate ?? "",
      );
      if (current?.customer.phone) {
        sessionStorage.setItem("lastOrderPhone", current.customer.phone);
      }
      sessionStorage.removeItem("luwag_ic_fired");
    } catch {
      // Storage unavailable: skip the success-page stashes; the order stands.
    }
    clearCheckoutDraft();
    clearAutosave(checkoutAttempt);
    clearStoredNewsletterCode();
    clearCheckoutIdempotencyKey(checkoutHref);
    if (!checkout.isBuyNow) {
      // F02: cleanup is not part of the success path.
      void cleanupCartInBackground(removeItems, checkout.cartItemIds, () => {
        clearCompletedCheckout(checkoutHref);
        clearCheckoutSubmission(checkoutHref);
      });
    }
    router.push(`/order-success/${orderNumber}`);
  }

  /**
   * F04: the request's outcome is unknown (timeout, offline, dropped
   * response, 5xx). Never report failure and never mint a new key: poll the
   * read-only attempt status under the same capability until the order shows
   * up or the recovery window ends.
   */
  function startRecovery(submission: CheckoutSubmission<CheckoutPayload>) {
    stopPolling();
    setPhase("CONFIRMING");
    inFlightRef.current = true;
    recoveryDeadlineRef.current = Date.now() + PLACE_ORDER_RECOVERY_WINDOW_MS;
    const poll = async () => {
      if (!aliveRef.current) return;
      if (Date.now() >= recoveryDeadlineRef.current) {
        inFlightRef.current = false;
        setPhase("UNKNOWN");
        return;
      }
      let ordered: Extract<
        Awaited<ReturnType<typeof api.checkoutAttemptStatus>>,
        { state: "ORDERED" }
      > | null = null;
      try {
        const status = await api.checkoutAttemptStatus(submission.idempotencyKey);
        if (status.state === "ORDERED") ordered = status;
      } catch {
        // Still offline: keep polling until the window ends.
      }
      if (!aliveRef.current) return;
      if (ordered) {
        finishOrder(
          ordered.orderNumber,
          ordered.grandTotal,
          ordered.items,
          submission.metaConsent,
        );
        return;
      }
      pollTimerRef.current = setTimeout(() => {
        void poll();
      }, ATTEMPT_POLL_INTERVAL_MS);
    };
    void poll();
  }

  async function placeOrder() {
    if (!draft || inFlightRef.current || promoChecking) return;
    if (phase === "SUBMITTING" || phase === "CONFIRMING") return;
    // F02: this exact checkout already produced an order in this tab (cleanup
    // may have failed, leaving the cart and this URL intact). Re-open the
    // receipt instead of submitting with a fresh key and creating a duplicate.
    const completed = findCompletedCheckout(checkoutHref);
    if (completed) {
      router.replace(`/order-success/${completed.orderNumber}`);
      return;
    }
    setError(null);
    const trackingItems = checkout.orderItems.map((item, index) => ({ ...item, variantName: checkout.lines[index]?.variant ?? null }));
    const occurrence = recordSubmitAttempt({ step: "confirm", items: trackingItems,
      scope: directSelection ? `PDP_INLINE:${directSelection.productSlug}:${JSON.stringify(directSelection.items)}` : attemptKey });
    const customer = { ...draft.customer, note: draft.customerNote ?? null };
    // Selections that never resolved to real, available SKUs can never be
    // confirmed — the backend re-validates, but a known-dead end stops here.
    if (unresolvedSelection || awaitingBuyNowResolution) {
      recordSubmitFailure({ occurrence, step: "confirm", reason: "STOCK", items: trackingItems, customer,
        error: new Error("Selected items are unavailable"), idempotencyKey: idempotencyKeyRef.current?.key ?? "" });
      return;
    }
    if (checkout.orderItems.length === 0) {
      setError("No items to check out.");
      recordSubmitFailure({ occurrence, step: "confirm", reason: "VALIDATION", items: trackingItems, customer,
        error: new Error("No items to check out."), idempotencyKey: "" });
      return;
    }

    // F04: one durable attempt per checkout scope. A stored attempt wins over
    // a freshly built payload, so a retry, a reload or the recovery loop all
    // replay the exact request that may already have created the order.
    const stored = readCheckoutSubmission<CheckoutPayload>(checkoutHref);
    if (stored?.status === "ORDERED" && stored.orderNumber) {
      router.replace(`/order-success/${stored.orderNumber}`);
      return;
    }
    let submission: CheckoutSubmission<CheckoutPayload>;
    if (stored) {
      submission = stored;
      idempotencyKeyRef.current = {
        scope: checkoutHref,
        key: stored.idempotencyKey,
        metaConsent: stored.metaConsent,
      };
    } else {
      const attempt =
        idempotencyKeyRef.current?.scope === checkoutHref
          ? idempotencyKeyRef.current
          : {
              scope: checkoutHref,
              ...checkoutIdempotencyAttempt(checkoutHref, hasAdsConsent()),
            };
      idempotencyKeyRef.current = attempt;
      const payload: CheckoutPayload = {
        customer: {
          ...draft.customer,
          barangay: draft.customer.barangay || null,
          postalCode: draft.customer.postalCode || null,
          landmark: draft.customer.landmark || null,
        },
        items: checkout.orderItems,
        ...readAttribution(),
        attribution: { sourceType: "ORGANIC" },
        preferredDeliveryDate: draft.preferredDeliveryDate ?? null,
        promoCode: appliedPromo?.code ?? null,
        customerNote: draft.customerNote ?? null,
        // Analytics-only: links this order to the visit that produced it.
        trackingSessionId: analyticsSessionId(),
        idempotencyKey: attempt.key,
        // Links the order to the unfinished-checkout draft it came from.
        checkoutDraftToken: readCheckoutAttemptToken(attemptKey),
        // Meta matching data, only meaningful (and only accepted by the
        // backend) when the shopper accepted optional cookies.
        ...readMetaBrowserIds(),
        metaConsent: attempt.metaConsent,
      };
      submission = beginCheckoutSubmission<CheckoutPayload>({
        scope: checkoutHref,
        idempotencyKey: attempt.key,
        metaConsent: attempt.metaConsent,
        attemptId: occurrence?.attemptId ?? null,
        startedAt: Date.now(),
        payload,
      });
    }

    inFlightRef.current = true;
    setPhase("SUBMITTING");
    try {
      const order = await api.createOrder(submission.payload);
      finishOrder(
        order.orderNumber,
        order.grandTotal,
        submission.payload.items,
        submission.metaConsent,
      );
    } catch (e) {
      if (outcomeIsUnknown(e)) {
        // A timeout is not a failure: the order may exist. Keep the attempt
        // and let the read-only status decide. Log only the diagnostic
        // (kind + status), never a customer snapshot or the key.
        logUnknownOutcome(e);
        startRecovery(submission);
        return;
      }
      // The backend answered 4xx: no order was created for this attempt, so
      // the shopper can correct the input and submit again (same key, no
      // stale payload).
      clearCheckoutSubmission(checkoutHref);
      recordSubmitFailure({
        occurrence, step: "confirm", reason: checkoutFailureReason(e), error: e,
        items: trackingItems, customer, idempotencyKey: submission.idempotencyKey,
      });
      inFlightRef.current = false;
      setPhase("IDLE");
      setError(e instanceof Error ? e.message : "Could not place your order. Please try again.");
    }
  }

  // Timers must not outlive the page; a poll that resolves after unmount is
  // ignored by the aliveRef guard above.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // auto=1: the shopper already reviewed the address and the summary on the
  // form page, so this step places the order as soon as the draft, the lines
  // and any promo validation are ready — no second confirmation. A durable
  // attempt (lost response / reload) and a completed order keep their own
  // recovery paths; neither ever submits again.
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!autoPlace || autoSubmittedRef.current) return;
    if (draft === null || promoChecking) return;
    if (awaitingBuyNowResolution || unresolvedSelection) return;
    if (readCheckoutSubmission(checkoutHref)) return;
    if (findCompletedCheckout(checkoutHref)) return;
    autoSubmittedRef.current = true;
    void placeOrder();
  }, [
    autoPlace,
    draft,
    promoChecking,
    awaitingBuyNowResolution,
    unresolvedSelection,
    checkoutHref,
  ]);

  if (draftUnavailable) {
    return (
      <div
        data-testid="confirm-storage-blocked"
        className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center"
      >
        <h1 className="text-2xl font-semibold text-ink">
          We couldn&apos;t open your saved details
        </h1>
        <p className="text-ink-secondary">
          This browser is blocking the storage used to carry your delivery
          details to this step. Please go back to checkout and review them —
          nothing has been ordered yet.
        </p>
        <Link
          href={editHref}
          className="inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-cta-foreground hover:bg-cta-hover"
        >
          Back to checkout
        </Link>
      </div>
    );
  }

  if (draft === null) {
    return <p className="py-16 text-center text-ink-secondary">Loading…</p>;
  }

  // Cart-path lines/totals are only meaningful once the cart has loaded;
  // otherwise the cold cart briefly renders an empty list and a ₱0.00 total
  // (cart-path total is 0, not null). Same gate as CheckoutForm.
  if (!checkout.isBuyNow && checkout.cartLoading) {
    return <p className="py-16 text-center text-ink-secondary">Loading…</p>;
  }

  // Once submission starts, cart cleanup can make this selection disappear
  // before navigation commits. Keep the accepted order in its submitting UI
  // instead of flashing the unavailable-selection error page.
  if (unresolvedSelection && !busy) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-16 text-center">
        <h1 className="mb-3 text-2xl font-semibold text-ink">
          We couldn&apos;t confirm this order.
        </h1>
        <p className="mb-6 text-ink-secondary">
          Some items may be out of stock or no longer available. Please review
          your selection and try again.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={editHref}
            className="inline-flex h-12 items-center justify-center rounded-lg bg-cta px-6 text-base font-semibold text-cta-foreground hover:bg-cta-hover"
          >
            {directSelection ? "Back to order form" : "Back to checkout"}
          </Link>
          <Link href="/collections" className="text-sm text-cta hover:underline">
            Continue shopping
          </Link>
        </div>
      </div>
    );
  }

  // auto=1 submission screen: the order is being placed without an extra
  // review step, so this page only reports progress and the recovery states.
  if (autoPlace) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">
          {phase === "UNKNOWN"
            ? "We couldn't confirm your order yet"
            : error
              ? "We couldn't place your order"
              : "Placing your order…"}
        </h1>
        {error ? (
          <p role="alert" data-testid="confirm-auto-error" className="text-sm text-sale">
            {error}
          </p>
        ) : phase === "UNKNOWN" ? (
          <p data-testid="confirm-unknown" className="text-sm text-ink-secondary">
            It may already have gone through. Tap TRY AGAIN to check the same
            attempt — you won&apos;t be charged twice.
          </p>
        ) : (
          <p data-testid="confirm-auto-progress" className="text-sm text-ink-secondary">
            {phase === "CONFIRMING"
              ? "We're confirming your order. Please keep this page open — this can take a few seconds."
              : "Sending your Cash on Delivery order — this can take a few seconds."}
          </p>
        )}
        <div className="w-full">
          <Button
            onClick={placeOrder}
            disabled={busy || promoChecking || (!error && phase !== "UNKNOWN")}
            className="w-full"
            data-testid="confirm-place-order"
          >
            {phase === "UNKNOWN" || error
              ? "TRY AGAIN"
              : phase === "CONFIRMING"
                ? "Confirming your order…"
                : "Placing order…"}
          </Button>
          {error || phase === "UNKNOWN" ? (
            <Link href={editHref} className="mt-3 inline-block text-sm text-cta hover:underline">
              Back to checkout
            </Link>
          ) : null}
        </div>
        {/* Headless promo validation: the code came from the form page and the
            priced result must exist before the request is built, but this
            submission screen shows no editable promo field. */}
        <div hidden>
          <PromoCodeField
            subtotal={checkout.totals.subtotal}
            initialCode={draft.promoCode ?? ""}
            onApplied={setAppliedPromo}
            onCheckingChange={setPromoChecking}
          />
        </div>
      </div>
    );
  }

  const area = [draft.customer.barangay, draft.customer.city].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-3xl font-semibold text-ink">Confirm your order</h1>

      <div className="mb-6">
        <CheckoutTrustStrip deliveryRange={deliveryWindowFor(draft.customer.province)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
        {/* Two flex columns, not a shared grid row: the address card is tall
            (map), so a row-based layout pushed the totals card far below the
            order summary. Keeping summary + totals in one column keeps them
            adjacent. */}
        <div className="flex flex-col gap-6 lg:col-start-1 lg:col-span-2">
          {/* Your Order */}
          <div data-testid="confirm-items" className="rounded-lg border border-border bg-card p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Your Order</h2>
              <Link href={editHref} className="text-sm text-cta hover:underline">
                Edit
              </Link>
            </div>
            <OrderPreview lines={checkout.lines} />
          </div>

          {/* Payment + totals */}
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm font-medium text-ink">Cash on Delivery</p>
              <dl className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">Subtotal</dt>
                  <dd className="font-medium text-ink">
                    {checkout.totals.savings > 0 ? (
                      <span data-testid="confirm-subtotal-compare" className="text-ink-muted">
                        {formatPrice(checkout.totals.compareAtTotal)}
                      </span>
                    ) : (
                      formatPrice(checkout.totals.subtotal)
                    )}
                  </dd>
                </div>
                {checkout.totals.savings > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-secondary">You save</dt>
                    <dd className="font-medium text-sale">−{formatPrice(checkout.totals.savings)}</dd>
                  </div>
                )}
                {appliedPromo && appliedPromo.discountAmount > 0 && (
                  <div className="flex justify-between" data-testid="confirm-promo-discount">
                    <dt className="text-ink-secondary">Promo discount</dt>
                    <dd className="font-medium text-sale">−{formatPrice(appliedPromo.discountAmount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">Shipping</dt>
                  <dd className="font-semibold text-ink">Free</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-3 text-base">
                  <dt className="font-semibold text-ink">Total (COD)</dt>
                  <dd className="font-bold text-ink">
                    {discountedTotal !== null
                      ? formatPrice(discountedTotal)
                      : "Calculated at checkout"}
                  </dd>
                </div>
              </dl>

              <PromoCodeField
                subtotal={checkout.totals.subtotal}
                initialCode={draft.promoCode ?? ""}
                onApplied={setAppliedPromo}
                onCheckingChange={setPromoChecking}
              />
              <NewsletterOfferPrompt appliedCode={appliedPromo?.code ?? null} />
            </div>

            <p
              data-testid="checkout-need-help"
              className="text-xs leading-relaxed text-ink-secondary"
            >
              <span className="font-semibold text-ink">Need help? </span>
              {messengerUrl ? (
                <>
                  <a
                    href={messengerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cta hover:underline"
                  >
                    Chat on Messenger
                  </a>
                  {" · "}
                </>
              ) : null}
              <a href={`mailto:${supportEmail}`} className="text-cta hover:underline">
                {supportEmail}
              </a>
              {" · "}
              {supportHours}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-start-3 lg:col-span-3">
          {/* Delivery address */}
          <div data-testid="confirm-address" className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Delivery Address</h2>
              <Link
                href={editHref}
                className="text-sm text-cta hover:underline"
              >
                Edit
              </Link>
            </div>
            <div className="text-sm text-ink-secondary">
              <p>
                {draft.customer.name} · {draft.customer.phone}
              </p>
              <p className="mt-1">{draft.customer.streetAddress}</p>
              {area ? <p className="mt-1">{area}</p> : null}
              <p className="mt-1">
                {draft.customer.province}
                {draft.customer.postalCode ? ` ${draft.customer.postalCode}` : ""}
              </p>
              {draft.customer.landmark ? (
                <p className="mt-1">{`Landmark: ${draft.customer.landmark}`}</p>
              ) : null}
            </div>
            {draft.preferredDeliveryDate ? (
              <p className="mt-3 text-sm text-ink-secondary" data-testid="confirm-preferred-date">
                {`Preferred delivery date: ${formatPreferredDate(draft.preferredDeliveryDate)}`}
              </p>
            ) : null}
            {draft.customerNote ? (
              <p className="mt-3 text-sm text-ink-secondary" data-testid="confirm-notes">
                {`Order notes: ${draft.customerNote}`}
              </p>
            ) : null}
            {draft.customer.streetAddress && draft.customer.city && draft.customer.province ? (
              <iframe
                data-testid="confirm-map"
                title="Delivery location map"
                className="mt-3 h-48 w-full rounded-lg border border-border"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(
                  `${draft.customer.streetAddress}, ${draft.customer.city}, ${draft.customer.province}`,
                )}&output=embed`}
              />
            ) : null}
            <p data-testid="checkout-privacy-note" className="mt-3 text-xs text-ink-secondary">
              Your information is used only to process and deliver your order.
            </p>
          </div>

          {/* Submit */}
          <div>
            {error && (
              <p
                role="alert"
                className="mb-3 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale"
              >
                {error}
              </p>
            )}

            {phase === "CONFIRMING" && (
              <p
                role="status"
                data-testid="confirm-checking"
                className="mb-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink-secondary"
              >
                We&apos;re confirming your order. Please keep this page open and
                don&apos;t submit again — this can take a few seconds.
              </p>
            )}

            {phase === "UNKNOWN" && (
              <p
                role="status"
                data-testid="confirm-unknown"
                className="mb-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink-secondary"
              >
                We couldn&apos;t confirm your order yet, but it may already have
                gone through. Tap Try again to check the same attempt — you
                won&apos;t be charged twice.
              </p>
            )}

            <p
              data-testid="checkout-autosave-status"
              aria-live="polite"
              className="mb-3 text-xs text-ink-muted"
            >
              {autosaveStatusLabel(confirmAutosave.status)}
            </p>

            <Button
              onClick={placeOrder}
              disabled={busy || awaitingBuyNowResolution || promoChecking}
              className="w-full"
              data-testid="confirm-place-order"
            >
              {phase === "SUBMITTING"
                ? "Placing order…"
                : phase === "CONFIRMING"
                  ? "Confirming your order…"
                  : phase === "UNKNOWN"
                    ? "TRY AGAIN"
                    : "PLACE COD ORDER"}
            </Button>
            <p className="mt-2 text-center text-xs text-ink-muted">
              Cash on Delivery
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
