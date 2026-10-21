"use client";

import { useState } from "react";
import { formatPrice } from "@/components/ui/PriceBox";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { formatOrderOptionsFromSnapshot } from "@/lib/order-options";
import type { GuestOrderResult } from "@/lib/guestOrder";

/**
 * The order card a shopper sees after a successful lookup.
 *
 * It replaces the lookup form entirely — there is nothing else on the page
 * while an order is open. Two states matter:
 * - the details are included (the shopper proved the mobile number): the full
 *   card, plus the other orders on the same number.
 * - only the order number was given: that number is a short sequential
 *   string, so the personal fields stay hidden until the mobile number is
 *   added — the card asks for it in place of the delivery address.
 */

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

export interface OrderDetailsProps {
  result: GuestOrderResult;
  /** Back to the lookup form. */
  onTrackAnother: () => void;
  /** The shopper added their mobile number — look the order up again. */
  onVerifyPhone: (phone: string) => void;
  /** The shopper picked another order from the same number. */
  onSelectOrder: (orderNumber: string) => void;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-5 py-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function OrderDetails({
  result,
  onTrackAnother,
  onVerifyPhone,
  onSelectOrder,
}: OrderDetailsProps) {
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();
  const [phone, setPhone] = useState("");
  const [verifying, setVerifying] = useState(false);

  // The backend orders statusHistory by createdAt asc — render in the
  // received order, no re-sort. statusDomain is a free String: orders.service
  // writes "ORDER_STATUS" for order-status changes ("CONFIRMATION_STATUS" is
  // the other domain).
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
  const currentStatus = timeline[timeline.length - 1]?.label ?? "";
  const statusIsProblem =
    result.orderStatus === "CANCELLED" || result.orderStatus === "DENIED";

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

  function submitVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = phone.trim();
    if (value === "" || verifying) return;
    setVerifying(true);
    onVerifyPhone(value);
  }

  return (
    <div>
      <button
        type="button"
        data-testid="track-another"
        onClick={onTrackAnother}
        className="mb-3 inline-flex items-center gap-1 text-sm text-cta hover:underline"
      >
        ← Track another order
      </button>

      <div
        data-testid="track-result"
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        {/* header */}
        <div className="bg-primary-light/50 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-secondary">
                Order
              </p>
              <p className="mt-0.5 font-mono text-sm font-bold tracking-[0.1em] text-ink">
                {result.orderNumber}
              </p>
            </div>
            <span
              data-testid="track-status"
              className={
                statusIsProblem
                  ? "shrink-0 rounded-full bg-sale/10 px-3 py-1 text-xs font-semibold text-sale"
                  : "shrink-0 rounded-full bg-cta px-3 py-1 text-xs font-semibold text-cta-foreground"
              }
            >
              {currentStatus}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-secondary">
            Placed on {formatDate(result.createdAt)}
          </p>
        </div>

        {/* progress */}
        <Section title="Progress">
          <ol data-testid="track-timeline">
            {timeline.map((row, index) => {
              const isCurrent = index === timeline.length - 1;
              return (
                <li key={row.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={
                        isCurrent
                          ? "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cta ring-4 ring-primary-light"
                          : "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-border"
                      }
                    />
                    {index < timeline.length - 1 && (
                      <span className="w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div
                    className={
                      index < timeline.length - 1 ? "flex-1 pb-4" : "flex-1"
                    }
                  >
                    <p
                      className={
                        isCurrent
                          ? "text-sm font-semibold text-ink"
                          : "text-sm text-ink-secondary"
                      }
                    >
                      {row.label}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">{row.date}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            <div
              data-testid="track-confirmation"
              className="rounded-lg bg-background px-3 py-2"
            >
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Confirmation
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {CONFIRMATION_LABELS[result.confirmationStatus] ??
                  result.confirmationStatus}
              </dd>
            </div>
            <div
              data-testid="track-payment"
              className="rounded-lg bg-background px-3 py-2"
            >
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Payment
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {PAYMENT_LABELS[result.paymentStatus] ?? result.paymentStatus}
              </dd>
            </div>
          </dl>
        </Section>

        {/* items */}
        <Section title="Items">
          {result.items.length === 0 ? (
            <p className="text-sm text-ink-secondary">No items on this order.</p>
          ) : (
            <ul data-testid="track-items" className="divide-y divide-border">
              {result.items.map((item) => {
                // Order-time snapshot first; the legacy variant text covers
                // lines created before the typed option graph.
                const optionsText = formatOrderOptionsFromSnapshot(
                  item.optionSnapshot,
                  item.variantSnapshot,
                );
                return (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        {item.productNameSnapshot}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {optionsText ? `${optionsText} · ` : ""}Qty{" "}
                        {item.quantity}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-ink">
                      {formatPrice(Number(item.lineTotal))}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* totals */}
        <Section title="Total">
          <dl data-testid="track-totals" className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Subtotal</dt>
              <dd className="font-medium text-ink">{formatPrice(subtotal)}</dd>
            </div>
            {discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Discount</dt>
                <dd className="font-medium text-sale">−{formatPrice(discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-secondary">Shipping</dt>
              <dd className="font-medium text-ink">
                {shipping > 0 ? formatPrice(shipping) : "Free"}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3 text-base">
              <dt className="font-semibold text-ink">Total (COD)</dt>
              <dd className="font-bold text-ink">{formatPrice(grandTotal)}</dd>
            </div>
          </dl>
        </Section>

        {/* delivery address, or the ask for the mobile number */}
        {addressLines.length > 0 ? (
          <Section title="Delivery address">
            <div
              data-testid="track-address"
              className="rounded-lg bg-background px-4 py-3 text-sm text-ink-secondary"
            >
              {addressLines.map((line, index) => (
                <p
                  key={index}
                  className={
                    index === 0
                      ? "font-medium text-ink"
                      : index === 1
                        ? "mt-1"
                        : "mt-1"
                  }
                >
                  {line}
                </p>
              ))}
            </div>
          </Section>
        ) : (
          <Section title="Delivery details">
            <div
              data-testid="track-verify"
              className="rounded-lg border border-cta/25 bg-primary-light/40 px-4 py-4"
            >
              <p className="text-sm font-semibold text-ink">
                Your delivery details are hidden
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                Your name, mobile number and delivery address are shown only to
                the person who can confirm the mobile number used at checkout.
                Add it below to see them.
              </p>
              <form
                onSubmit={submitVerification}
                noValidate
                className="mt-3 flex gap-2"
              >
                <input
                  data-testid="track-verify-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="0917 123 4567"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="Mobile number"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
                />
                <button
                  type="submit"
                  data-testid="track-verify-submit"
                  disabled={verifying || phone.trim() === ""}
                  className="shrink-0 rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {verifying ? "Checking…" : "Verify"}
                </button>
              </form>
            </div>
          </Section>
        )}

        {/* the other orders on this mobile number */}
        {result.otherOrders.length > 0 && (
          <Section title="Other orders on this number">
            <ul data-testid="track-other-orders" className="divide-y divide-border">
              {result.otherOrders.map((order) => (
                <li key={order.orderNumber}>
                  <button
                    type="button"
                    data-testid={`track-other-${order.orderNumber}`}
                    onClick={() => onSelectOrder(order.orderNumber)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-semibold text-ink">
                        {order.orderNumber}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {formatDate(order.createdAt)} ·{" "}
                        {ORDER_STATUS_LABELS[order.orderStatus] ??
                          order.orderStatus}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-ink">
                      {formatPrice(Number(order.grandTotal))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* help */}
        <div className="border-t border-border px-5 py-4">
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
    </div>
  );
}
