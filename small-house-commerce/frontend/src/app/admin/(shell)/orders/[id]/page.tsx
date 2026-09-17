"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Button } from "@/components/ui/Button";
import {
  adminApi,
  formatAmount,
  type AdminOrderDetail,
  type OrderStatus,
  type SourceType,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

// Eligibility sets mirrored verbatim from the Task 5 orders list page.
const CONFIRM_BLOCKED = new Set<OrderStatus>([
  "CANCELLED",
  "DENIED",
  "SHIPPING",
  "SIGNED",
]);

const CANCEL_BLOCKED = new Set<OrderStatus>([
  "CANCELLED",
  "DENIED",
  "SIGNED",
  "AFTER_SALES",
  "SHIPPING",
]);

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  FB_POST: "Facebook post",
  META_AD: "Meta ad",
  ORGANIC: "Organic",
  DIRECT: "Direct",
  EMAIL: "Email",
  OTHER: "Other",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Preferred delivery date is a calendar date (@db.Date, UTC midnight on the
// wire): same en-PH date style as formatDateTime, without the time part.
// Falls back to the raw value if it cannot be parsed.
function formatPreferredDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function textOrDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoGrid({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}): ReactNode {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {item.label}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrderDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { hasPermission } = useAdminAuth();
  const canConfirmPerm = hasPermission("ORDER_CONFIRM");
  const canCancelPerm = hasPermission("ORDER_CANCEL");
  // Spec §13.5 / §8.4: cost snapshots render only under profit visibility.
  const canViewProfit = hasPermission("REPORT_PROFIT_VIEW");

  // --- detail data ----------------------------------------------------------

  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Last route id the rendered state belongs to; see the render-phase reset
  // below (after all useState declarations).
  const [observedId, setObservedId] = useState(id);
  const queryKey = `${id}|${nonce}`;
  // Loading is DERIVED (same pattern as the orders list): true until this
  // exact key settles — no synchronous setState in the fetch effect body.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const loading = settledKey !== queryKey;
  const initialLoading = loading && order === null && !loadError && !notFound;

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // T5 review pattern: a late resolution after unmount must never setState.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    adminApi
      .getOrder(id)
      .then((detail) => {
        if (!active || !mounted.current) return;
        setOrder(detail);
        setLoadError(null);
        setNotFound(false);
      })
      .catch((err: unknown) => {
        if (!active || !mounted.current) return;
        // Only the GET/load path maps 404 to the not-found state; mutation
        // failures keep surfacing their verbatim message inside the dialog.
        if (errorStatus(err) === 404) {
          setNotFound(true);
        } else {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load order.",
          );
        }
      })
      .finally(() => {
        if (active && mounted.current) setSettledKey(queryKey);
      });
    return () => {
      active = false;
    };
  }, [id, queryKey]);

  // --- confirm / cancel -----------------------------------------------------

  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  // Client-side navigation between order ids does not remount this page.
  // Reset every order-derived state DURING RENDER when the id changes — React's
  // sanctioned "store information from previous renders" pattern (also used by
  // the orders list URL sync) — so the new fetch shows the skeleton instead of
  // the previous order, whose action buttons would be bound to the OLD id, or
  // a lingering "Order not found." state. On initial mount observedId === id,
  // so nothing resets and there is no flash beyond the intended skeleton. The
  // post-action refetch bumps `nonce` only (same id), skips this reset, and
  // keeps the rendered order on screen.
  if (id !== observedId) {
    setObservedId(id);
    setOrder(null);
    setLoadError(null);
    setNotFound(false);
    setSettledKey(null);
    setDialog(null);
    setActionError(null);
    setActionPending(false);
  }

  const openDialog = useCallback((kind: "confirm" | "cancel") => {
    setActionError(null);
    setDialog(kind);
  }, []);

  const closeDialog = useCallback(() => {
    // Do not allow dismissal while the mutation is in flight.
    if (actionPending) return;
    setDialog(null);
    setActionError(null);
  }, [actionPending]);

  const submitAction = useCallback(async () => {
    if (!dialog || !order) return;
    setActionPending(true);
    setActionError(null);
    try {
      if (dialog === "confirm") {
        await adminApi.confirmOrder(order.id);
      } else {
        await adminApi.cancelOrder(order.id);
      }
      // The mutation returns a bare Order row — never patch from it. Refetch
      // the whole detail so badges, timeline and reservations resync.
      if (!mounted.current) return;
      setDialog(null);
      setActionError(null);
      setNonce((n) => n + 1);
    } catch (err) {
      // Any non-2xx (even a 404 — mutations never flip the page to
      // not-found): keep the dialog open and show the message verbatim.
      if (!mounted.current) return;
      setActionError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      if (mounted.current) setActionPending(false);
    }
  }, [dialog, order]);

  const onDialogSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitAction();
  };

  // Timeline is rendered oldest-first; sort defensively in case the wire
  // order drifts (contract says ascending).
  const timeline = useMemo(() => {
    if (!order) return [];
    return [...order.statusHistory].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [order]);

  // --- render ---------------------------------------------------------------

  if (initialLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <Link
          href="/admin/orders"
          className="text-sm font-medium text-ink-muted hover:text-ink"
        >
          ← Orders
        </Link>
        <div className="mt-4">
          <TableSkeleton rows={8} cols={4} />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <Link
          href="/admin/orders"
          className="text-sm font-medium text-ink-muted hover:text-ink"
        >
          ← Orders
        </Link>
        <div className="mt-4">
          <EmptyState
            title="Order not found."
            action={
              <Link
                href="/admin/orders"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-cta/40 px-6 text-base font-semibold text-cta hover:bg-primary-light/40"
              >
                Back to orders
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <Link
          href="/admin/orders"
          className="text-sm font-medium text-ink-muted hover:text-ink"
        >
          ← Orders
        </Link>
        <div role="alert" className="mt-4 rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-semibold text-ink">
            Couldn&apos;t load order.
          </p>
          <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
          <Button
            variant="secondary"
            size="md"
            onClick={refetch}
            className="mt-4"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const canConfirm =
    canConfirmPerm &&
    !CONFIRM_BLOCKED.has(order.orderStatus) &&
    order.confirmationStatus !== "CONFIRMED";
  const canCancel = canCancelPerm && !CANCEL_BLOCKED.has(order.orderStatus);
  const currency = order.currency;
  const attribution = order.attribution;

  const addressRows: { label: string; value: ReactNode }[] = order.shippingAddress
    ? [
        { label: "Full name", value: textOrDash(order.shippingAddress.fullName) },
        { label: "Phone", value: textOrDash(order.shippingAddress.phone) },
        {
          label: "Street address",
          value: textOrDash(order.shippingAddress.streetAddress),
        },
        { label: "Barangay", value: textOrDash(order.shippingAddress.barangay) },
        {
          label: "City / Municipality",
          value: textOrDash(order.shippingAddress.city),
        },
        {
          label: "Province",
          value: textOrDash(order.shippingAddress.province),
        },
        {
          label: "Postal code",
          value: textOrDash(order.shippingAddress.postalCode),
        },
        {
          label: "Landmark",
          value: textOrDash(order.shippingAddress.landmark),
        },
      ]
    : [];

  if (order.preferredDeliveryDate) {
    addressRows.push({
      label: "Preferred delivery date",
      value: formatPreferredDate(order.preferredDeliveryDate),
    });
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <Link
        href="/admin/orders"
        className="text-sm font-medium text-ink-muted hover:text-ink"
      >
        ← Orders
      </Link>

      <div className="mt-2">
        <PageHeader
          title={order.orderNumber}
          actions={
            canConfirm || canCancel ? (
              <div className="flex items-center gap-3">
                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => openDialog("cancel")}
                    disabled={actionPending}
                    aria-busy={dialog === "cancel" && actionPending}
                    className="inline-flex h-12 min-w-[120px] items-center justify-center rounded-lg border border-red-300 px-6 text-base font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel order
                  </button>
                ) : null}
                {canConfirm ? (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => openDialog("confirm")}
                    disabled={actionPending}
                    aria-busy={dialog === "confirm" && actionPending}
                  >
                    Confirm
                  </Button>
                ) : null}
              </div>
            ) : undefined
          }
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge value={order.orderStatus} />
          <Badge value={order.confirmationStatus} />
          <Badge value={order.paymentStatus} />
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-ink-muted" aria-live="polite">
          Refreshing…
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {/* Order */}
        <Card title="Order">
          <InfoGrid
            items={[
              { label: "Created", value: formatDateTime(order.createdAt) },
              { label: "Updated", value: formatDateTime(order.updatedAt) },
              { label: "Currency", value: textOrDash(order.currency) },
              {
                label: "Subtotal",
                value: formatAmount(order.subtotal, currency),
              },
              {
                label: "Discount",
                value: formatAmount(order.discountTotal, currency),
              },
              {
                label: "Shipping",
                value: formatAmount(order.shippingTotal, currency),
              },
              {
                label: "Grand total",
                value: (
                  <span className="font-semibold">
                    {formatAmount(order.grandTotal, currency)}
                  </span>
                ),
              },
              ...(order.confirmedAt
                ? [
                    {
                      label: "Confirmed at",
                      value: formatDateTime(order.confirmedAt),
                    },
                  ]
                : []),
              ...(order.confirmedBy
                ? [{ label: "Confirmed by", value: order.confirmedBy }]
                : []),
              ...(order.confirmationNote
                ? [
                    {
                      label: "Confirmation note",
                      value: textOrDash(order.confirmationNote),
                    },
                  ]
                : []),
            ]}
          />
        </Card>

        {/* Customer & address */}
        <Card title="Customer & address">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Customer
              </h3>
              <dl className="mt-3 grid grid-cols-1 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-ink-muted">Name</dt>
                  <dd className="text-sm text-ink">
                    {textOrDash(order.customer.name)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Phone</dt>
                  <dd className="text-sm text-ink">
                    {textOrDash(order.customer.normalizedPhone)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Email</dt>
                  <dd className="break-words text-sm text-ink">
                    {textOrDash(order.customer.email)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Risk level</dt>
                  <dd className="mt-0.5 text-sm">
                    <Badge value={order.customer.currentRiskLevel} />
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-ink-muted" title="Customer ID">
                ID: {order.customer.id}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Shipping address
              </h3>
              {order.shippingAddress ? (
                <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                  {addressRows.map((row) => (
                    <div key={row.label}>
                      <dt className="text-xs text-ink-muted">{row.label}</dt>
                      <dd className="text-sm text-ink">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">—</p>
              )}
            </div>
          </div>
        </Card>

        {/* Items (+ reservations sub-section) */}
        <Card title={`Items (${order.items.length})`}>
          {order.items.length === 0 ? (
            <p className="text-sm text-ink-muted">No items.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <caption className="sr-only">Order items</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-3 py-2">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Variant
                    </th>
                    <th scope="col" className="px-3 py-2">
                      SKU
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Qty
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Unit price
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Unit discount
                    </th>
                    {canViewProfit ? (
                      <th scope="col" className="px-3 py-2 text-right">
                        Unit cost
                      </th>
                    ) : null}
                    <th scope="col" className="px-3 py-2 text-right">
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-ink">
                        {textOrDash(item.productNameSnapshot)}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary">
                        {textOrDash(item.variantSnapshot)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                        {textOrDash(item.skuCodeSnapshot)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink">
                        {item.quantity}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-ink">
                        {formatAmount(item.unitPrice, currency)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-ink-secondary">
                        {formatAmount(item.unitDiscount, currency)}
                      </td>
                      {canViewProfit ? (
                        <td className="whitespace-nowrap px-3 py-2 text-right text-ink-secondary">
                          {formatAmount(item.unitCostSnapshot, currency)}
                        </td>
                      ) : null}
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-ink">
                        {formatAmount(item.lineTotal, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      colSpan={canViewProfit ? 8 : 7}
                      className="px-3 py-3"
                    >
                      <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm text-ink-secondary">
                        <span>
                          Subtotal{" "}
                          <span className="font-medium text-ink">
                            {formatAmount(order.subtotal, currency)}
                          </span>
                        </span>
                        <span>
                          Discount{" "}
                          <span className="font-medium text-ink">
                            {formatAmount(order.discountTotal, currency)}
                          </span>
                        </span>
                        <span>
                          Shipping{" "}
                          <span className="font-medium text-ink">
                            {formatAmount(order.shippingTotal, currency)}
                          </span>
                        </span>
                        <span>
                          Grand total{" "}
                          <span className="font-semibold text-ink">
                            {formatAmount(order.grandTotal, currency)}
                          </span>
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Reservations — read-only sub-section of Items (m2). */}
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Reservations
            </h3>
            {order.reservations.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No reservations.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Stock reservations</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-3 py-2">
                      SKU ID
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Warehouse
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Qty
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.reservations.map((reservation) => (
                    <tr
                      key={reservation.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-ink-secondary">
                        {reservation.skuId}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary">
                        {reservation.warehouseId}
                      </td>
                      <td className="px-3 py-2 text-right text-ink">
                        {reservation.quantity}
                      </td>
                      <td className="px-3 py-2">
                        <Badge value={reservation.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                        {formatDateTime(reservation.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </Card>

        {/* Attribution — M3: order-level snapshots vs attribution relation. */}
        <Card title="Attribution">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Optimizer (order snapshot)
              </h3>
              <InfoGrid
                items={[
                  {
                    label: "AID",
                    value: textOrDash(order.optimizerAidSnapshot),
                  },
                  {
                    label: "Optimizer name",
                    value: textOrDash(order.optimizerNameSnapshot),
                  },
                  {
                    label: "Customer classification",
                    value: textOrDash(order.customerClassification),
                  },
                  {
                    label: "Optimizer ID",
                    value: textOrDash(order.optimizerId),
                  },
                ]}
              />
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Attribution record
              </h3>
              <InfoGrid
                items={[
                  {
                    label: "Source type",
                    value: attribution
                      ? (SOURCE_TYPE_LABELS[attribution.sourceType] ??
                        attribution.sourceType)
                      : "—",
                  },
                  {
                    label: "AID",
                    value: textOrDash(attribution?.aidSnapshot),
                  },
                  {
                    label: "Facebook page",
                    value: textOrDash(attribution?.facebookPageId),
                  },
                  {
                    label: "Facebook post",
                    value: textOrDash(attribution?.facebookPostId),
                  },
                  {
                    label: "Post tracking code",
                    value: textOrDash(attribution?.facebookPostTrackingCode),
                  },
                  {
                    label: "Campaign",
                    value: textOrDash(attribution?.campaignId),
                  },
                  {
                    label: "Ad set",
                    value: textOrDash(attribution?.adsetId),
                  },
                  {
                    label: "Ad",
                    value: textOrDash(attribution?.adId),
                  },
                  {
                    label: "Landing page",
                    value: textOrDash(attribution?.landingPageId),
                  },
                  {
                    label: "UTM source",
                    value: textOrDash(attribution?.utmSource),
                  },
                  {
                    label: "UTM medium",
                    value: textOrDash(attribution?.utmMedium),
                  },
                  {
                    label: "UTM campaign",
                    value: textOrDash(attribution?.utmCampaign),
                  },
                  {
                    label: "UTM content",
                    value: textOrDash(attribution?.utmContent),
                  },
                  {
                    label: "UTM term",
                    value: textOrDash(attribution?.utmTerm),
                  },
                  {
                    label: "FBCLID",
                    value: textOrDash(attribution?.fbclid),
                  },
                  {
                    label: "Attributed at",
                    value: attribution
                      ? formatDateTime(attribution.attributedAt)
                      : "—",
                  },
                ]}
              />
            </div>
          </div>
        </Card>

        {/* Payments */}
        <Card title={`Payments (${order.payments.length})`}>
          {order.payments.length === 0 ? (
            <p className="text-sm text-ink-muted">No payments.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Order payments</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-3 py-2">
                      Method
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Amount
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Reference
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Paid at
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((payment) => (
                    <tr
                      key={payment.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-ink">{payment.method}</td>
                      <td className="px-3 py-2">
                        <Badge value={payment.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-ink">
                        {formatAmount(payment.amount, currency)}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary">
                        {textOrDash(payment.reference)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                        {formatDateTime(payment.paidAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Timeline */}
        <Card title={`Timeline (${timeline.length})`}>
          {timeline.length === 0 ? (
            <p className="text-sm text-ink-muted">No status history.</p>
          ) : (
            <ol>
              {timeline.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2.5 text-sm last:border-0"
                >
                  <Badge value={entry.statusDomain} tone="neutral" />
                  <span className="font-medium text-ink">
                    {entry.oldStatus ?? "—"} → {entry.newStatus}
                  </span>
                  <span className="text-ink-muted">{entry.source}</span>
                  <span className="text-xs text-ink-muted">
                    operator: {entry.operatorId ?? "—"}
                  </span>
                  <span className="text-ink-secondary">
                    {entry.comment ?? "—"}
                  </span>
                  <time
                    dateTime={entry.createdAt}
                    className="ml-auto whitespace-nowrap text-xs text-ink-muted"
                  >
                    {formatDateTime(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Dialog
        open={dialog !== null}
        onClose={closeDialog}
        title={dialog === "cancel" ? "Cancel order" : "Confirm order"}
        width="sm"
      >
        <form onSubmit={onDialogSubmit}>
          <p className="text-sm text-ink-secondary">
            {dialog === "cancel"
              ? `Cancel order ${order.orderNumber}? Reserved stock is released.`
              : `Confirm order ${order.orderNumber}? This marks it confirmed for fulfillment.`}
          </p>
          {actionError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
            >
              {actionError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={closeDialog}
              disabled={actionPending}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={actionPending}
              aria-busy={actionPending}
            >
              {actionPending
                ? "Working…"
                : dialog === "cancel"
                  ? "Cancel order"
                  : "Confirm"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export default function AdminOrderDetailPage(): ReactNode {
  return <OrderDetailPage />;
}
