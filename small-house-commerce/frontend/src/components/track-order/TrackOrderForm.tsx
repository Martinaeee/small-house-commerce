"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { validatePhone } from "@/lib/checkoutValidation";
import { lookupOrder, type GuestOrderResult } from "@/lib/guestOrder";
import { OrderList } from "./OrderList";

/**
 * Guest order tracking (guest-order-tracking spec §3.2, revised 2026-10-21).
 *
 * The shopper may enter EITHER the order number OR the mobile number — one
 * of them is enough. Until an order is open the page shows the lookup form;
 * once it is, the form is replaced by the order details (the page shows
 * nothing else while an order is open).
 */

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

const ORDER_NUMBER_PATTERN = /^PH\d+$/;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-sale">
      {message}
    </p>
  );
}

interface FieldErrors {
  orderNumber?: string;
  phone?: string;
}

interface TrackOrderFormProps {
  prefillOrder?: string;
}

export function TrackOrderForm({ prefillOrder }: TrackOrderFormProps) {
  const [orderNumber, setOrderNumber] = useState(
    () => prefillOrder?.trim().toUpperCase() ?? "",
  );
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuestOrderResult | null>(null);

  // The shopper entered this number at checkout in this same tab, so prefill
  // it and leave tracking one click away. Deferred to an effect (never read
  // during render) so SSR and the first client render agree — same pattern as
  // PreferredDateLine. sessionStorage here is tab-scoped and holds nothing the
  // shopper did not just type themselves.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      try {
        const stored = sessionStorage.getItem("lastOrderPhone");
        if (stored) setPhone((current) => current || stored);
      } catch {
        // Storage unavailable: the field simply stays empty.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Editing either field invalidates any previously shown result/outcome —
  // the card below always reflects the latest successful submission.
  function changeOrderNumber(value: string) {
    setOrderNumber(value.trim().toUpperCase());
    setErrors((current) => {
      if (!current.orderNumber) return current;
      const next = { ...current };
      delete next.orderNumber;
      return next;
    });
    setError(null);
    setResult(null);
  }

  function changePhone(value: string) {
    setPhone(value);
    setErrors((current) => {
      if (!current.phone) return current;
      const next = { ...current };
      delete next.phone;
      return next;
    });
    setError(null);
    setResult(null);
  }

  async function runLookup(input: {
    orderNumber?: string;
    phone?: string;
  }): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const found = await lookupOrder(input);
      setResult(found);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not look up your order. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const nextErrors: FieldErrors = {};
    const trimmedOrder = orderNumber.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedOrder && !trimmedPhone) {
      nextErrors.orderNumber =
        "Enter your order number or your mobile number.";
    } else if (trimmedOrder && !ORDER_NUMBER_PATTERN.test(trimmedOrder)) {
      nextErrors.orderNumber =
        "Enter your order number as PH followed by digits (e.g. PH100006).";
    }
    if (trimmedPhone) {
      const phoneError = validatePhone(trimmedPhone);
      if (phoneError) nextErrors.phone = phoneError;
    }
    setErrors(nextErrors);
    if (nextErrors.orderNumber || nextErrors.phone) return;

    await runLookup({
      orderNumber: trimmedOrder === "" ? undefined : trimmedOrder,
      phone: trimmedPhone === "" ? undefined : trimmedPhone,
    });
  }

  // The shopper added their mobile number to the withheld-details card.
  async function verifyPhone(value: string) {
    if (!result || result.orders.length === 0) return;
    setPhone(value);
    await runLookup({
      orderNumber: result.orders[0].orderNumber,
      phone: value,
    });
  }

  if (result) {
    return (
      <div>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale"
          >
            {error}
          </p>
        )}
        <OrderList
          result={result}
          onTrackAnother={() => setResult(null)}
          onVerifyPhone={(value) => void verifyPhone(value)}
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold text-ink">Track Your Order</h1>
      <p className="mt-2 text-ink-secondary">
        Enter your order number or your mobile number — either one is enough.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Order Number
            <input
              id="track-order-number"
              data-testid="track-order-number"
              className={`${inputCls}${errors.orderNumber ? " border-sale" : ""}`}
              value={orderNumber}
              onChange={(e) => changeOrderNumber(e.target.value)}
              aria-invalid={Boolean(errors.orderNumber)}
              aria-describedby={
                errors.orderNumber ? "track-order-number-error" : undefined
              }
              placeholder="PH100006"
              autoComplete="off"
            />
            <FieldError id="track-order-number" message={errors.orderNumber} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Mobile Number
            <input
              id="track-phone"
              data-testid="track-phone"
              className={`${inputCls}${errors.phone ? " border-sale" : ""}`}
              value={phone}
              onChange={(e) => changePhone(e.target.value)}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "track-phone-error" : undefined}
              placeholder="0917 123 4567"
              inputMode="tel"
              autoComplete="tel"
            />
            <FieldError id="track-phone" message={errors.phone} />
          </label>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full"
          data-testid="track-submit"
        >
          {submitting ? "Tracking…" : "TRACK ORDER"}
        </Button>
      </form>

      <p
        data-testid="track-privacy-note"
        className="mt-3 text-xs text-ink-secondary"
      >
        Your order details are shown to the person who knows the order number
        or the mobile number used at checkout.
      </p>
    </div>
  );
}
