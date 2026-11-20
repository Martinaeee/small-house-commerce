"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PurchaseTracking } from "@/components/tracking/PurchaseTracking";
import { useCart } from "@/components/cart/CartContext";
import { api, type PaymentStatusResponse } from "@/lib/api";
import { purchaseEvent, storePurchasePayload } from "@/lib/commerce-events";
import { clearPaymentSession, readPaymentSession } from "@/lib/paymentSession";
import { SunrateMount } from "./SunrateMount";

/** The first retry waits a second; the backoff grows to five seconds. */
const FIRST_POLL_MS = 1_000;
const MAX_POLL_MS = 5_000;
/** After a minute the page stops asking and points at self-service. */
const POLL_DEADLINE_MS = 60_000;

type ViewState = "LOADING" | "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "MISSING";

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { status?: number }).status === 404;

/**
 * The page the shopper comes back to after paying — or the page that waits
 * while the payment is still on its way.
 *
 * It asks the server what happened to the order (the capability cookie names
 * it) and never decides anything on its own: only a verified PAID counts as
 * paid, and only a verified PAID fires the Purchase event.
 */
export function PaymentReturnClient({ orderNumber }: { orderNumber: string }) {
  const [view, setView] = useState<ViewState>("LOADING");
  const [status, setStatus] = useState<PaymentStatusResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [paySession, setPaySession] = useState<string | null>(null);
  const firedRef = useRef(false);
  const { cart, removeItems } = useCart();

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    let delay = FIRST_POLL_MS;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const answer = await api.getPaymentStatus(orderNumber);
        if (!alive) return;
        setStatus(answer);
        setError(null);
        if (answer.paymentStatus === "PAID") {
          setView("PAID");
          return;
        }
        if (answer.paymentStatus === "FAILED") {
          setView("FAILED");
          return;
        }
        if (answer.paymentStatus === "CANCELLED") {
          setView("CANCELLED");
          return;
        }
        setView("PENDING");
        if (Date.now() - startedAt >= POLL_DEADLINE_MS) {
          setTimedOut(true);
          return;
        }
        timer = window.setTimeout(poll, delay);
        delay = Math.min(delay * 2, MAX_POLL_MS);
      } catch (thrown) {
        if (!alive) return;
        if (isNotFound(thrown)) {
          // No capability, no order, no answer — the same for all three.
          setView("MISSING");
          return;
        }
        setError("We could not check your payment yet. Please try again in a moment.");
        if (Date.now() - startedAt >= POLL_DEADLINE_MS) {
          setTimedOut(true);
          return;
        }
        timer = window.setTimeout(poll, delay);
        delay = Math.min(delay * 2, MAX_POLL_MS);
      }
    };

    void poll();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [orderNumber]);

  // The card session travels from the checkout in memory only. A reload
  // loses it, and the page then waits for the status instead of mounting a
  // form the shopper cannot complete.
  useEffect(() => {
    let alive = true;
    void (async () => {
      // The await keeps the setState out of the effect's synchronous body
      // (react-hooks/set-state-in-effect; the codebase's convention).
      await Promise.resolve();
      if (!alive) return;
      const session = readPaymentSession();
      if (!session || session.orderNumber !== orderNumber) return;
      setPaySession(session.paySession);
    })();
    return () => {
      alive = false;
    };
  }, [orderNumber]);

  // Only the first PAID answer fires the Purchase event and clears the cart.
  useEffect(() => {
    if (view !== "PAID" || !status || firedRef.current) return;
    firedRef.current = true;
    if (status.value !== undefined && status.items !== undefined) {
      storePurchasePayload(
        purchaseEvent({
          orderId: orderNumber,
          items: status.items,
          value: status.value,
        }),
        status.metaConsent === true,
      );
    }
    const ordered = new Set((status.items ?? []).map((item) => item.skuId));
    const lines = (cart?.items ?? []).filter((item) => ordered.has(item.skuId));
    if (lines.length > 0) {
      void removeItems(lines.map((item) => item.itemId));
    }
  }, [view, status, orderNumber, cart, removeItems]);

  const retry = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      const result = await api.retryPayment();
      if (result.payment.payUrl) {
        window.location.assign(result.payment.payUrl);
        return;
      }
      if (result.payment.paySession) {
        clearPaymentSession();
        setPaySession(result.payment.paySession);
        setView("PENDING");
      }
    } catch (thrown) {
      const status_ = (thrown as { status?: number }).status;
      if (status_ === 409) {
        setError("This payment is still being processed. Please wait a moment.");
      } else if (status_ === 404) {
        setView("MISSING");
      } else {
        setError("We could not start the payment again. Please try again.");
      }
    } finally {
      setRetrying(false);
    }
  }, []);

  if (view === "MISSING") {
    return (
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">
          We couldn&apos;t find that payment
        </h1>
        <p className="text-ink-secondary">
          Open your order with the number and mobile you used at checkout.
        </p>
        <ButtonLink href="/track-order" variant="secondary" className="w-full">
          Track your order
        </ButtonLink>
        <Link href="/" className="text-sm text-cta hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  if (view === "PAID") {
    return (
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
        <PurchaseTracking orderNumber={orderNumber} />
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-light/50 text-3xl text-cta">
          ✓
        </span>
        <h1 className="text-2xl font-semibold text-ink">Payment received</h1>
        <p className="text-ink-secondary">
          We&apos;ve received your payment. Your order is on its way.
        </p>
        <div className="w-full rounded-lg border border-border bg-card p-6 text-left">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Order Number</dt>
              <dd className="font-semibold text-ink">{orderNumber}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Amount</dt>
              <dd className="font-semibold text-ink">
                {status?.currency === "PHP" ? "₱" : ""}
                {status?.amount?.toFixed(2) ?? ""}
              </dd>
            </div>
          </dl>
        </div>
        <ButtonLink href="/track-order" variant="secondary" className="w-full">
          Track your order
        </ButtonLink>
      </div>
    );
  }

  if (view === "FAILED") {
    return (
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">Payment didn&apos;t go through</h1>
        <p className="text-ink-secondary">
          Your order {orderNumber} is still here. You can try the payment again.
        </p>
        {error !== null && (
          <p role="alert" data-testid="payment-retry-error" className="text-sm text-sale">
            {error}
          </p>
        )}
        <Button
          onClick={() => void retry()}
          disabled={retrying}
          className="w-full"
          data-testid="payment-retry"
        >
          {retrying ? "Starting…" : "Retry payment"}
        </Button>
        <ButtonLink href="/track-order" variant="secondary" className="w-full">
          Track your order
        </ButtonLink>
      </div>
    );
  }

  if (view === "CANCELLED") {
    return (
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">This order was cancelled</h1>
        <p className="text-ink-secondary">
          The order {orderNumber} was cancelled, so no payment is due.
        </p>
        <ButtonLink href="/track-order" variant="secondary" className="w-full">
          Track your order
        </ButtonLink>
      </div>
    );
  }

  // Pending: the card form (when there is one) and the waiting copy.
  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-ink">
        {timedOut ? "We&apos;re still waiting for your payment" : "Checking your payment…"}
      </h1>
      <p className="text-ink-secondary">
        {timedOut
          ? "This can take a few minutes. Your order is saved — you can also track it below."
          : "Please keep this page open. Do not pay twice for the same order."}
      </p>
      {error !== null && (
        <p role="status" data-testid="payment-status-error" className="text-sm text-sale">
          {error}
        </p>
      )}
      {paySession !== null && status !== null ? (
        // The environment comes from the server. Without it the card form is
        // never mounted — a production payment must not run against the test
        // gateway, and the form reports that it is unavailable.
        <SunrateMount
          paySession={paySession}
          env={status.env ?? ""}
          onError={(message) => setError(message)}
        />
      ) : null}
      <ButtonLink href="/track-order" variant="secondary" className="w-full">
        Track your order
      </ButtonLink>
    </div>
  );
}
