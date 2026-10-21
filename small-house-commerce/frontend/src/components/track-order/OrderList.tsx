"use client";

import { useState } from "react";
import { formatPrice } from "@/components/ui/PriceBox";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { formatOrderOptionsFromSnapshot } from "@/lib/order-options";
import type { GuestOrderResult, GuestOrderView } from "@/lib/guestOrder";

/**
 * The order details a shopper sees after a successful lookup.
 *
 * The page shows the lookup form only until an order is open; after that it
 * shows the order list and nothing else. Each order is its own collapsible
 * card (so several orders on one mobile number are easy to scan), and inside
 * a card the status history is folded up too: collapsed it keeps the latest
 * status, expanded it shows the full history.
 *
 * The card reads top to bottom: order number (header) → delivery address →
 * placed date → items → total → order status history.
 *
 * Type: the order number 19px, the module titles 14px, the body 14px and the
 * helper text 13px, all in the normal sentence case - the small letter-spaced
 * capitals of the old card read cold at this size.
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

export interface OrderListProps {
  result: GuestOrderResult;
  /** Back to the lookup form. */
  onTrackAnother: () => void;
  /** The shopper added their mobile number — look the order up again. */
  onVerifyPhone: (phone: string) => void;
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
      <h3 className="text-[14px] font-medium text-ink">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export function OrderList({
  result,
  onTrackAnother,
  onVerifyPhone,
}: OrderListProps) {
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();
  return (
    <div>
      <button
        type="button"
        data-testid="track-another"
        onClick={onTrackAnother}
        className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-cta hover:underline"
      >
        ← Track another order
      </button>

      <div data-testid="track-result" className="flex flex-col gap-3">
        {result.orders.map((order, index) => (
          <OrderCard
            key={order.id}
            order={order}
            personalDetailsIncluded={result.personalDetailsIncluded}
            defaultExpanded={index === 0}
            onVerifyPhone={onVerifyPhone}
          />
        ))}
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <ShieldIcon />
          Your order information stays private.
        </p>
        <p
          data-testid="checkout-need-help"
          className="mt-3 text-[14px] leading-6 text-ink"
        >
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

function OrderCard({
  order,
  personalDetailsIncluded,
  defaultExpanded,
  onVerifyPhone,
}: {
  order: GuestOrderView;
  personalDetailsIncluded: boolean;
  defaultExpanded: boolean;
  onVerifyPhone: (phone: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [verifyPhone, setVerifyPhone] = useState("");
  const [verifying, setVerifying] = useState(false);

  // The backend orders statusHistory by createdAt asc — render in the
  // received order, no re-sort. statusDomain is a free String: orders.service
  // writes "ORDER_STATUS" for order-status changes.
  const orderEntries = order.statusHistory.filter(
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
            label: ORDER_STATUS_LABELS[order.orderStatus] ?? order.orderStatus,
            date: formatDate(order.createdAt),
          },
        ];
  const currentStatus = timeline[timeline.length - 1]?.label ?? "";
  const statusIsProblem =
    order.orderStatus === "CANCELLED" || order.orderStatus === "DENIED";

  const address = personalDetailsIncluded ? order.shippingAddress : null;
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
    const value = verifyPhone.trim();
    if (value === "" || verifying) return;
    setVerifying(true);
    onVerifyPhone(value);
  }

  return (
    <div
      data-testid={`track-order-${order.orderNumber}`}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      {/* header: the whole card folds up */}
      <button
        type="button"
        data-testid={`track-toggle-${order.orderNumber}`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="block w-full px-5 py-4 text-left"
      >
        {/* row 1: the order number and what it came to */}
        <span className="flex items-center gap-2.5">
          <Chevron open={expanded} />
          <span className="min-w-0 flex-1 truncate font-mono text-[19px] font-semibold tracking-[0.03em] text-ink">
            {order.orderNumber}
          </span>
          <span className="shrink-0 text-[15px] font-semibold text-ink">
            {formatPrice(Number(order.grandTotal))}
          </span>
        </span>
        {/* row 2: when it was placed, and where it stands now */}
        <span className="mt-1.5 flex items-center gap-2.5 pl-6.5">
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
            Placed on {formatDate(order.createdAt)}
          </span>
          <span
            data-testid={`track-status-${order.orderNumber}`}
            className={
              statusIsProblem
                ? "shrink-0 rounded-full bg-sale/10 px-2.5 py-1 text-[13px] font-medium text-sale"
                : "shrink-0 rounded-full bg-cta px-2.5 py-1 text-[13px] font-medium text-cta-foreground"
            }
          >
            {currentStatus}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* delivery address, or the ask for the mobile number */}
          {addressLines.length > 0 ? (
            <Section title="Delivery address">
              <div
                data-testid={`track-address-${order.orderNumber}`}
                className="text-[14px] leading-6 text-ink-secondary"
              >
                {addressLines.map((line, index) => (
                  <p
                    key={index}
                    className={index === 0 ? "font-medium text-ink" : "mt-0.5"}
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
                <p className="text-[14px] font-medium text-ink">
                  Your delivery details are hidden
                </p>
                <p className="mt-1.5 text-[14px] leading-6 text-ink-secondary">
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
                    value={verifyPhone}
                    onChange={(event) => setVerifyPhone(event.target.value)}
                    placeholder="0917 123 4567"
                    inputMode="tel"
                    autoComplete="tel"
                    aria-label="Mobile number"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none"
                  />
                  <button
                    type="submit"
                    data-testid="track-verify-submit"
                    disabled={verifying || verifyPhone.trim() === ""}
                    className="shrink-0 rounded-lg bg-cta px-4 py-2.5 text-[14px] font-medium text-cta-foreground hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {verifying ? "Checking…" : "Verify"}
                  </button>
                </form>
              </div>
            </Section>
          )}

          {/* placed on */}
          <Section title="Placed">
            <p
              data-testid={`track-placed-${order.orderNumber}`}
              className="text-[14px] text-ink-secondary"
            >
              {formatDate(order.createdAt)}
            </p>
          </Section>

          {/* items */}
          <Section title="Items">
            {order.items.length === 0 ? (
              <p className="text-[14px] text-ink-secondary">
                No items on this order.
              </p>
            ) : (
              <ul
                data-testid={`track-items-${order.orderNumber}`}
                className="space-y-4"
              >
                {order.items.map((item) => {
                  const optionsText = formatOrderOptionsFromSnapshot(
                    item.optionSnapshot,
                    item.variantSnapshot,
                  );
                  return (
                    <li key={item.id} className="flex gap-3.5">
                      {item.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnailUrl}
                          alt={item.productNameSnapshot}
                          data-testid={`track-item-image-${item.id}`}
                          className="h-[76px] w-[76px] shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div
                          className="h-[76px] w-[76px] shrink-0 rounded-lg bg-primary-light/60"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium leading-6 text-ink">
                          {item.productNameSnapshot}
                        </p>
                        <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
                          {optionsText ? `${optionsText} · ` : ""}SKU{" "}
                          {item.skuCodeSnapshot}
                        </p>
                        <p className="mt-1 text-[13px] text-ink-secondary">
                          Qty {item.quantity} ·{" "}
                          {formatPrice(Number(item.unitPrice))} each
                        </p>
                      </div>
                      <p className="shrink-0 text-[15px] font-semibold text-ink">
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
            <dl
              data-testid={`track-totals-${order.orderNumber}`}
              className="flex flex-col gap-2 text-[14px]"
            >
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Subtotal</dt>
                <dd className="font-medium text-ink">
                  {formatPrice(Number(order.subtotal))}
                </dd>
              </div>
              {Number(order.discountTotal) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">Discount</dt>
                  <dd className="font-medium text-sale">
                    −{formatPrice(Number(order.discountTotal))}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Shipping</dt>
                <dd className="font-medium text-ink">
                  {Number(order.shippingTotal) > 0
                    ? formatPrice(Number(order.shippingTotal))
                    : "Free"}
                </dd>
              </div>
              <div className="mt-1 flex justify-between border-t border-border pt-3 text-[16px]">
                <dt className="font-semibold text-ink">Total (COD)</dt>
                <dd className="font-bold text-ink">
                  {formatPrice(Number(order.grandTotal))}
                </dd>
              </div>
            </dl>
            {/* The confirmation state is our own review queue, not something a
                shopper can act on, so the card leaves it out; the payment
                state below is theirs. */}
            <dl className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-[14px]">
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Payment</dt>
                <dd className="font-medium text-ink">
                  {PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus}
                </dd>
              </div>
            </dl>
          </Section>

          {/* status history: folded keeps the latest status */}
          <Section title="Order status">
            <button
              type="button"
              data-testid={`track-history-${order.orderNumber}`}
              onClick={() => setHistoryOpen((value) => !value)}
              aria-expanded={historyOpen}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="text-[14px] font-medium text-ink">
                {currentStatus}
              </span>
              <Chevron open={historyOpen} />
            </button>
            {historyOpen && (
              <ol
                data-testid={`track-timeline-${order.orderNumber}`}
                className="mt-3"
              >
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
                          index < timeline.length - 1
                            ? "flex-1 pb-4"
                            : "flex-1"
                        }
                      >
                        <p
                          className={
                            isCurrent
                              ? "text-[14px] font-semibold text-ink"
                              : "text-[14px] text-ink-secondary"
                          }
                        >
                          {row.label}
                        </p>
                        <p className="mt-0.5 text-[13px] text-ink-muted">
                          {row.date}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
