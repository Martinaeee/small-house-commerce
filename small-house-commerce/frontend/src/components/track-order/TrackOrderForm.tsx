"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { validatePhone } from "@/lib/checkoutValidation";
import { lookupOrder, type GuestOrderResult } from "@/lib/guestOrder";
import { OrderList } from "./OrderList";

/**
 * Guest order tracking (guest-order-tracking spec §3.2, revised 2026-10-21).
 *
 * ONE field: the shopper types EITHER the order number OR the mobile
 * number. The shape of the value decides which one it is, so there is no
 * second box to fill and no "which one do I need" question. Until an order is
 * open the page shows the lookup form; after that it shows the order and
 * nothing else.
 */

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3.5 py-3 text-[16px] text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

const ORDER_NUMBER_PATTERN = /^PH\d+$/i;

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 text-ink-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        d="M10 2.5 4 5v4.5c0 3.4 2.4 6.6 6 8 3.6-1.4 6-4.6 6-8V5l-6-2.5Z"
        strokeLinejoin="round"
      />
      <path
        d="m7.6 9.8 1.8 1.8 3-3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface TrackOrderFormProps {
  prefillOrder?: string;
}

export function TrackOrderForm({ prefillOrder }: TrackOrderFormProps) {
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();
  const [query, setQuery] = useState(
    () => prefillOrder?.trim().toUpperCase() ?? "",
  );
  const [errors, setErrors] = useState<{ query?: string }>({});
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
        if (stored) setQuery((current) => current || stored);
      } catch {
        // Storage unavailable: the field simply stays empty.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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

    const value = query.trim();
    if (value === "") {
      setErrors({
        query: "Enter your order number or your mobile number.",
      });
      return;
    }

    // The shape of the value decides what it is: PH + digits is an order
    // number, anything else is treated as a mobile number.
    if (ORDER_NUMBER_PATTERN.test(value)) {
      setErrors({});
      await runLookup({ orderNumber: value.toUpperCase() });
      return;
    }

    const phoneError = validatePhone(value);
    if (phoneError) {
      setErrors({ query: phoneError });
      return;
    }
    setErrors({});
    await runLookup({ phone: value });
  }

  // The shopper added their mobile number to the withheld-details card.
  async function verifyPhone(value: string) {
    if (!result || result.orders.length === 0) return;
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
            className="mb-4 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-[14px] text-sale"
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
      <h1 className="text-[30px] font-semibold leading-tight text-ink">
        Track Your Order
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-ink-secondary">
        Enter your order number or your mobile number — either one is enough.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-6">
        <label
          className="flex flex-col gap-1.5 text-[14px] font-medium text-ink"
          htmlFor="track-query"
        >
          Order number or mobile number
          <input
            id="track-query"
            data-testid="track-query"
            className={`${inputCls}${errors.query ? " border-sale" : ""}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setErrors({});
              setError(null);
            }}
            aria-invalid={Boolean(errors.query)}
            aria-describedby={errors.query ? "track-query-error" : undefined}
            placeholder="PH100006 or 0917 123 4567"
            autoComplete="off"
            inputMode="text"
          />
        </label>
        {errors.query ? (
          <p
            id="track-query-error"
            role="alert"
            className="mt-1.5 text-[13px] text-sale"
          >
            {errors.query}
          </p>
        ) : null}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-[14px] text-sale"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="mt-5 h-12 w-full text-[15px] font-semibold"
          data-testid="track-submit"
        >
          {submitting ? "Tracking…" : "TRACK ORDER"}
        </Button>
      </form>

      <div className="mt-8 border-t border-border pt-5">
        <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <ShieldIcon />
          Your order information stays private.
        </p>
        <p className="mt-3 text-[14px] leading-6 text-ink">
          Need help?{" "}
          <a
            href={messengerUrl ? messengerUrl : `mailto:${supportEmail}`}
            target={messengerUrl ? "_blank" : undefined}
            rel={messengerUrl ? "noopener noreferrer" : undefined}
            data-testid="track-support-link"
            className="font-medium text-cta underline underline-offset-2"
          >
            Contact customer support
          </a>
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          {supportEmail} · {supportHours}
        </p>
      </div>
    </div>
  );
}
