"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/components/ui/PriceBox";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { validatePhone } from "@/lib/checkoutValidation";
import { lookupOrder, type GuestOrderResult } from "@/lib/guestOrder";

/**
 * Guest order tracking (guest-order-tracking spec §3.2). Order number +
 * mobile number exact match on the backend; every non-match surfaces one
 * uniform message (lib/guestOrder.ts), so this client never distinguishes
 * "not found" from "wrong phone".
 */

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

const ORDER_NUMBER_PATTERN = /^PH\d+$/;

// Spec §3.2 verbatim status wording.
const ORDER_STATUS_LABELS: Record<string, string> = {
  NEW: "Order Received",
  PENDING: "Awaiting confirmation",
  QUESTION: "Questioning",
  CONFIRMED: "Confirmed",
  ABNORMAL: "Delivery issue",
  SHIPPING: "Out for delivery",
  SIGNED: "Delivered",
  CANCELLED: "Cancelled",
  DENIED: "Denied",
  AFTER_SALES: "After-sales",
};

const CONFIRMATION_LABELS: Record<string, string> = {
  UNCONFIRMED: "Not yet confirmed",
  NEEDS_REVIEW: "Needs review",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
};

const PAYMENT_LABELS: Record<string, string> = {
  COD_PENDING: "Cash on Delivery · Awaiting payment",
  COLLECTED: "Collected",
  SETTLEMENT_PENDING: "Settling",
  SETTLED: "Settled",
  ONLINE_PENDING: "Online payment pending",
  PAID: "Paid",
  FAILED: "Payment failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

const manilaDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(value: string): string {
  return manilaDate.format(new Date(value));
}

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const nextErrors: FieldErrors = {};
    if (!orderNumber) {
      nextErrors.orderNumber = "Please enter your order number.";
    } else if (!ORDER_NUMBER_PATTERN.test(orderNumber)) {
      nextErrors.orderNumber =
        "Enter your order number as PH followed by digits (e.g. PH100012).";
    }
    if (!phone.trim()) {
      nextErrors.phone = "Please enter your mobile number.";
    } else {
      const phoneError = validatePhone(phone);
      if (phoneError) nextErrors.phone = phoneError;
    }
    setErrors(nextErrors);
    if (nextErrors.orderNumber || nextErrors.phone) return;

    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const found = await lookupOrder(orderNumber, phone.trim());
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

  return (
    <div>
      <form onSubmit={handleSubmit} noValidate>
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
              placeholder="PH100012"
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
        Your order details are shown only to the person with the order number
        and mobile number used at checkout.
      </p>

      {result && (
        <div className="mt-6">
          <ResultCard result={result} />
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: GuestOrderResult }) {
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();

  // The backend include orders statusHistory by createdAt asc
  // (ORDER_DETAIL_INCLUDE) — render in the received order, no re-sort.
  // statusDomain is a free String: orders.service writes "ORDER_STATUS" for
  // order-status changes ("CONFIRMATION_STATUS" is the other domain).
  const orderEntries = result.statusHistory.filter(
    (entry) => entry.statusDomain === "ORDER_STATUS",
  );
  const timeline =
    orderEntries.length > 0
      ? orderEntries.map((entry) => ({
          id: entry.id,
          label: ORDER_STATUS_LABELS[entry.newStatus] ?? entry.newStatus,
          date: formatDate(entry.createdAt),
        }))
      : [
          {
            id: "current",
            label:
              ORDER_STATUS_LABELS[result.orderStatus] ?? result.orderStatus,
            date: formatDate(result.createdAt),
          },
        ];

  const subtotal = Number(result.subtotal);
  const discount = Number(result.discountTotal);
  const shipping = Number(result.shippingTotal);
  const grandTotal = Number(result.grandTotal);

  const address = result.shippingAddress;
  const addressLines = address
    ? [
        [address.fullName, address.phone].filter(Boolean).join(" · "),
        address.streetAddress,
        [address.barangay, address.city].filter(Boolean).join(", "),
        [address.province, address.postalCode].filter(Boolean).join(" "),
        address.landmark ? `Landmark: ${address.landmark}` : "",
      ].filter((line) => line.trim().length > 0)
    : [];

  return (
    <div
      data-testid="track-result"
      className="divide-y divide-border rounded-lg border border-border bg-card p-5"
    >
      <div className="pb-4">
        <h2 className="text-lg font-semibold text-ink">
          Order {result.orderNumber}
        </h2>
        <p className="mt-0.5 text-sm text-ink-secondary">
          Placed on {formatDate(result.createdAt)}
        </p>
      </div>

      <div className="py-4">
        <ol data-testid="track-timeline">
          {timeline.map((row, index) => {
            const isCurrent = index === timeline.length - 1;
            return (
              <li
                key={row.id}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span
                  className={
                    isCurrent
                      ? "text-sm font-semibold text-ink"
                      : "text-sm text-ink-secondary"
                  }
                >
                  {row.label}
                </span>
                <span
                  className={
                    isCurrent
                      ? "text-xs font-semibold text-ink"
                      : "text-xs text-ink-secondary"
                  }
                >
                  {row.date}
                </span>
              </li>
            );
          })}
        </ol>
        <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <div
            className="flex justify-between"
            data-testid="track-confirmation"
          >
            <dt className="text-ink-secondary">Confirmation</dt>
            <dd className="font-medium text-ink">
              {CONFIRMATION_LABELS[result.confirmationStatus] ??
                result.confirmationStatus}
            </dd>
          </div>
          <div className="flex justify-between" data-testid="track-payment">
            <dt className="text-ink-secondary">Payment</dt>
            <dd className="font-medium text-ink">
              {PAYMENT_LABELS[result.paymentStatus] ?? result.paymentStatus}
            </dd>
          </div>
        </dl>
      </div>

      <div className="py-4">
        <h2 className="text-sm font-semibold text-ink">Items</h2>
        <ul data-testid="track-items" className="mt-1 divide-y divide-border">
          {result.items.map((item) => (
            <li key={item.id} className="flex gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {item.productNameSnapshot}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {item.variantSnapshot ? `${item.variantSnapshot} · ` : ""}
                  Qty {item.quantity}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-ink">
                  {formatPrice(Number(item.unitPrice) * item.quantity)}
                </p>
                {item.quantity > 1 && (
                  <p className="text-xs text-ink-muted">
                    {formatPrice(Number(item.unitPrice))} each
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="py-4">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Subtotal</dt>
            <dd className="font-medium text-ink">{formatPrice(subtotal)}</dd>
          </div>
          {discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Discount</dt>
              <dd className="font-medium text-sale">
                −{formatPrice(discount)}
              </dd>
            </div>
          )}
          {shipping > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Shipping</dt>
              <dd className="font-medium text-ink">{formatPrice(shipping)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-3 text-base">
            <dt className="font-semibold text-ink">Total (COD)</dt>
            <dd className="font-bold text-ink">{formatPrice(grandTotal)}</dd>
          </div>
        </dl>
      </div>

      {addressLines.length > 0 && (
        <div className="py-4">
          <h2 className="text-sm font-semibold text-ink">Delivery Address</h2>
          <div
            data-testid="track-address"
            className="mt-1 text-sm text-ink-secondary"
          >
            {addressLines.map((line, index) => (
              <p key={index} className={index === 0 ? undefined : "mt-1"}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4">
        <p
          data-testid="checkout-need-help"
          className="text-xs leading-relaxed text-ink-secondary sm:max-w-[420px]"
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
  );
}
