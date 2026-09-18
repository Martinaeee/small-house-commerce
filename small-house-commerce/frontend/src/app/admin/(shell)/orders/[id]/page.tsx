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
import { Field } from "@/components/admin/Field";
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

// Customer classification badge (CUSTOMER_RISK_SPEC §16 display rules).
function ClassificationBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const tone =
    value === "RECHECK"
      ? "bg-red-100 text-red-700"
      : value === "RPT"
        ? "bg-amber-100 text-amber-700"
        : value === "AGAIN"
          ? "bg-green-100 text-green-700"
          : "bg-primary-light/40 text-cta";
  const dot =
    value === "RECHECK" ? "🔴" : value === "RPT" ? "🟡" : value === "AGAIN" ? "🟢" : "⚪";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      <span aria-hidden>{dot}</span>
      {value}
    </span>
  );
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

  // --- confirm / cancel / review --------------------------------------------

  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  // Review decision for RPT/RECHECK orders (CUSTOMER_RISK_SPEC §17): the
  // customer-service agent records how the customer was handled.
  const [reviewDecision, setReviewDecision] = useState<
    "CONFIRM" | "CANCEL" | "REQUEST_INFO" | ""
  >("");
  const [reviewNote, setReviewNote] = useState("");

  // --- workbench: edit / merge / assign / notes / flags ----------------------
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    phone: "",
    province: "",
    city: "",
    barangay: "",
    postalCode: "",
    streetAddress: "",
    landmark: "",
  });
  const [editNote, setEditNote] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [customerNoteInput, setCustomerNoteInput] = useState("");
  const [flagType, setFlagType] = useState("CUSTOMER_RECHECK");
  const [flagReason, setFlagReason] = useState("");
  const [workbenchBusy, setWorkbenchBusy] = useState(false);
  const [workbenchError, setWorkbenchError] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let active = true;
    adminApi
      .listAssignees()
      .then((users) => {
        if (active) setAssignees(users);
      })
      .catch(() => {
        // Non-fatal.
      });
    return () => {
      active = false;
    };
  }, []);

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
    setReviewDecision("");
    setReviewNote("");
    setShowEdit(false);
    setMergeOpen(false);
    setNoteInput("");
    setCustomerNoteInput("");
    setWorkbenchError(null);
  }

  const openDialog = useCallback((kind: "confirm" | "cancel") => {
    setActionError(null);
    setReviewDecision("");
    setReviewNote("");
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
        const cls = order.customerClassification;
        const needsReview = cls === "RPT" || cls === "RECHECK";
        if (needsReview && !reviewDecision) {
          setActionError("This order requires a review decision before confirmation.");
          setActionPending(false);
          return;
        }
        await adminApi.confirmOrderWithDecision(
          order.id,
          needsReview
            ? {
                decision: reviewDecision as "CONFIRM" | "CANCEL" | "REQUEST_INFO",
                note: reviewNote || undefined,
              }
            : { decision: "CONFIRM" },
        );
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
  }, [dialog, order, reviewDecision, reviewNote]);

  const handleAssign = useCallback(async (assignedToId: string) => {
    if (!order) return;
    setWorkbenchBusy(true);
    setWorkbenchError(null);
    try {
      await adminApi.assignOrder(order.id, assignedToId);
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              assignedTo: {
                id: assignedToId,
                name: assignees.find((u) => u.id === assignedToId)?.name ?? null,
              },
            }
          : prev,
      );
    } catch (err) {
      setWorkbenchError(err instanceof Error ? err.message : "Assignment failed.");
    } finally {
      setWorkbenchBusy(false);
    }
  }, [order, assignees]);

  const submitNote = useCallback(async () => {
    if (!order || !noteInput.trim()) return;
    setWorkbenchBusy(true);
    setWorkbenchError(null);
    try {
      await adminApi.addOrderNote(order.id, noteInput.trim());
      setNoteInput("");
      setNonce((n) => n + 1);
    } catch (err) {
      setWorkbenchError(err instanceof Error ? err.message : "Failed to add note.");
    } finally {
      setWorkbenchBusy(false);
    }
  }, [order, noteInput]);

  const submitCustomerNote = useCallback(async () => {
    if (!order || !customerNoteInput.trim()) return;
    setWorkbenchBusy(true);
    setWorkbenchError(null);
    try {
      await adminApi.addCustomerNote(
        order.customerId,
        customerNoteInput.trim(),
        order.id,
      );
      setCustomerNoteInput("");
      setNonce((n) => n + 1);
    } catch (err) {
      setWorkbenchError(
        err instanceof Error ? err.message : "Failed to add customer note.",
      );
    } finally {
      setWorkbenchBusy(false);
    }
  }, [order, customerNoteInput]);

  const submitRiskFlag = useCallback(async () => {
    if (!order) return;
    setWorkbenchBusy(true);
    setWorkbenchError(null);
    try {
      await adminApi.addRiskFlag(order.id, flagType, flagReason || undefined);
      setFlagReason("");
      setNonce((n) => n + 1);
    } catch (err) {
      setWorkbenchError(err instanceof Error ? err.message : "Failed to add flag.");
    } finally {
      setWorkbenchBusy(false);
    }
  }, [order, flagType, flagReason]);

  const resolveFlag = useCallback(async (flagId: string) => {
    setWorkbenchBusy(true);
    setWorkbenchError(null);
    try {
      await adminApi.resolveRiskFlag(flagId);
      setNonce((n) => n + 1);
    } catch (err) {
      setWorkbenchError(err instanceof Error ? err.message : "Failed to resolve flag.");
    } finally {
      setWorkbenchBusy(false);
    }
  }, []);

  const submitMerge = useCallback(
    async (mergedOrderId: string, reason: string) => {
      if (!order) return;
      setWorkbenchBusy(true);
      setWorkbenchError(null);
      try {
        await adminApi.mergeOrders(order.id, mergedOrderId, reason || undefined);
        setMergeOpen(false);
        setMergeTarget("");
        setMergeReason("");
        setNonce((n) => n + 1);
      } catch (err) {
        setWorkbenchError(
          err instanceof Error ? err.message : "Merge failed.",
        );
      } finally {
        setWorkbenchBusy(false);
      }
    },
    [order],
  );

  const openEdit = useCallback(() => {
    if (!order) return;
    setEditForm({
      fullName: order.shippingAddress?.fullName ?? "",
      phone: order.shippingAddress?.phone ?? "",
      province: order.shippingAddress?.province ?? "",
      city: order.shippingAddress?.city ?? "",
      barangay: order.shippingAddress?.barangay ?? "",
      postalCode: order.shippingAddress?.postalCode ?? "",
      streetAddress: order.shippingAddress?.streetAddress ?? "",
      landmark: order.shippingAddress?.landmark ?? "",
    });
    setEditNote("");
    setWorkbenchError(null);
    setShowEdit(true);
  }, [order]);

  const submitEdit = useCallback(async () => {
    if (!order) return;
    setWorkbenchBusy(true);
    setWorkbenchError(null);
    try {
      await adminApi.editOrder(order.id, {
        shippingAddress: {
          fullName: editForm.fullName,
          phone: editForm.phone,
          province: editForm.province,
          city: editForm.city,
          barangay: editForm.barangay || null,
          postalCode: editForm.postalCode || null,
          streetAddress: editForm.streetAddress,
          landmark: editForm.landmark || null,
        },
        note: editNote || undefined,
      });
      setShowEdit(false);
      setNonce((n) => n + 1);
    } catch (err) {
      setWorkbenchError(
        err instanceof Error ? err.message : "Failed to save changes.",
      );
    } finally {
      setWorkbenchBusy(false);
    }
  }, [order, editForm, editNote]);

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
              <div className="flex flex-wrap items-center gap-3">
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
                <Button variant="secondary" size="md" onClick={openEdit}>
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setMergeTarget("");
                    setMergeReason("");
                    setWorkbenchError(null);
                    setMergeOpen(true);
                  }}
                >
                  Merge
                </Button>
              </div>
            ) : undefined
          }
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ClassificationBadge value={order.customerClassification} />
          <Badge value={order.orderStatus} />
          <Badge value={order.confirmationStatus} />
          <Badge value={order.paymentStatus} />
          {order.riskFlags.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              ⚠ {order.riskFlags.length} risk flag(s)
            </span>
          ) : null}
          <div className="ml-1 flex items-center gap-2">
            <label className="text-xs text-ink-muted">Assigned</label>
            <select
              value={order.assignedTo?.id ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                if (value) void handleAssign(value);
              }}
              className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-ink"
            >
              <option value="">—</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? "—"}
                </option>
              ))}
            </select>
          </div>
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
                    {entry.operatorName ?? entry.operatorId ?? "system"}
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

        {/* Order notes (§46) */}
        <Card title={`Order Notes (${order.notes?.length ?? 0})`}>
          {order.notes && order.notes.length > 0 ? (
            <ul className="mb-4 space-y-3">
              {order.notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg border border-border bg-background p-3 text-sm"
                >
                  <p className="text-ink">{note.content}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {note.noteType} · {note.operatorName ?? "—"} ·{" "}
                    {formatDateTime(note.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-ink-muted">No notes.</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Internal note…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              aria-label="Order note"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => void submitNote()}
              disabled={workbenchBusy || !noteInput.trim()}
            >
              Add
            </Button>
          </div>
        </Card>

        {/* Customer notes (§13) + risk logs */}
        <Card title={`Customer Notes (${order.customer.notes?.length ?? 0})`}>
          {order.customer.notes && order.customer.notes.length > 0 ? (
            <ul className="mb-4 space-y-3">
              {order.customer.notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg border border-border bg-background p-3 text-sm"
                >
                  <p className="text-ink">{note.note}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {note.operatorName ?? "—"} · {formatDateTime(note.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-ink-muted">No customer notes.</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={customerNoteInput}
              onChange={(e) => setCustomerNoteInput(e.target.value)}
              placeholder="Customer communication…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              aria-label="Customer note"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => void submitCustomerNote()}
              disabled={workbenchBusy || !customerNoteInput.trim()}
            >
              Add
            </Button>
          </div>
          {order.customer.riskLogs && order.customer.riskLogs.length > 0 ? (
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Risk history
              </h3>
              <ul className="mt-2 space-y-1.5">
                {order.customer.riskLogs.slice(0, 8).map((log) => (
                  <li key={log.id} className="text-xs text-ink-secondary">
                    <span className="font-medium text-ink">{log.riskType}</span>
                    {" — "}
                    {log.reason ?? ""}
                    <span className="text-ink-muted">
                      {" "}
                      · {log.operatorName ?? "system"} ·{" "}
                      {formatDateTime(log.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        {/* Risk flags (§47) */}
        <Card title={`Risk Flags (${order.riskFlags?.length ?? 0})`}>
          {order.riskFlags && order.riskFlags.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {order.riskFlags.map((flag) => (
                <li
                  key={flag.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3 text-sm"
                >
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      flag.resolved
                        ? "bg-primary-light/40 text-ink-muted"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {flag.resolved ? "✓ " : "⚠ "}
                    {flag.flagType}
                  </span>
                  <span className="flex-1 text-ink-secondary">
                    {flag.reason ?? ""}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {formatDateTime(flag.createdAt)}
                  </span>
                  {!flag.resolved ? (
                    <button
                      type="button"
                      onClick={() => void resolveFlag(flag.id)}
                      disabled={workbenchBusy}
                      className="text-sm font-semibold text-cta hover:underline disabled:cursor-not-allowed disabled:text-ink-muted"
                    >
                      Resolve
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-ink-muted">No risk flags.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Flag type" htmlFor="workbench-flag-type">
              <select
                id="workbench-flag-type"
                value={flagType}
                onChange={(e) => setFlagType(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-2 text-sm text-ink"
              >
                <option value="CUSTOMER_RECHECK">Customer recheck</option>
                <option value="POSSIBLE_DUPLICATE">Possible duplicate</option>
                <option value="CUSTOMER_BLOCKED">Customer blocked</option>
              </select>
            </Field>
            <input
              type="text"
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Reason…"
              className="w-full max-w-[240px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              aria-label="Flag reason"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => void submitRiskFlag()}
              disabled={workbenchBusy}
            >
              Add flag
            </Button>
          </div>
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
          {dialog === "confirm" &&
          (order.customerClassification === "RPT" ||
            order.customerClassification === "RECHECK") ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800">
                ⚠ This order is {order.customerClassification} — customer-service
                review required
              </p>
              <div className="mt-3">
                <Field label="Review decision" htmlFor="review-decision">
                  <select
                    id="review-decision"
                    value={reviewDecision}
                    onChange={(e) =>
                      setReviewDecision(
                        e.target.value as "CONFIRM" | "CANCEL" | "REQUEST_INFO" | "",
                      )
                    }
                    className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-ink"
                  >
                    <option value="">Select…</option>
                    <option value="CONFIRM">Confirm — customer verified</option>
                    <option value="CANCEL">Cancel — refused / unreachable</option>
                    <option value="REQUEST_INFO">Request info — need details</option>
                  </select>
                </Field>
                <Field label="Review note" htmlFor="review-note">
                  <input
                    id="review-note"
                    type="text"
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="What did the customer say?"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
                  />
                </Field>
              </div>
            </div>
          ) : null}
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

      {/* Edit order (shipping address) */}
      <Dialog
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title={`Edit order ${order.orderNumber}`}
        width="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitEdit();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="edit-name">
              <input
                id="edit-name"
                type="text"
                value={editForm.fullName}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, fullName: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Phone" htmlFor="edit-phone">
              <input
                id="edit-phone"
                type="text"
                value={editForm.phone}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, phone: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Street address" htmlFor="edit-street">
              <input
                id="edit-street"
                type="text"
                value={editForm.streetAddress}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, streetAddress: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Barangay" htmlFor="edit-barangay">
              <input
                id="edit-barangay"
                type="text"
                value={editForm.barangay}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, barangay: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="City / Municipality" htmlFor="edit-city">
              <input
                id="edit-city"
                type="text"
                value={editForm.city}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, city: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Province" htmlFor="edit-province">
              <input
                id="edit-province"
                type="text"
                value={editForm.province}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, province: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Postal code" htmlFor="edit-postal">
              <input
                id="edit-postal"
                type="text"
                value={editForm.postalCode}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, postalCode: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Landmark" htmlFor="edit-landmark">
              <input
                id="edit-landmark"
                type="text"
                value={editForm.landmark}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, landmark: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Edit note (optional)" htmlFor="edit-note">
              <input
                id="edit-note"
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Why are you editing this order?"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
          {workbenchError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
            >
              {workbenchError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setShowEdit(false)}
              disabled={workbenchBusy}
            >
              Back
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={workbenchBusy}>
              Save changes
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Merge order */}
      <Dialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge order"
        width="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitMerge(mergeTarget.trim(), mergeReason.trim());
          }}
        >
          <p className="text-sm text-ink-secondary">
            Merge another order into {order.orderNumber}. Only NEW/PENDING/CONFIRMED
            orders of the same customer / phone / address can be merged. The merged
            order is cancelled and its items move here.
          </p>
          <div className="mt-4">
            <Field label="Order number to merge" htmlFor="merge-target">
              <input
                id="merge-target"
                type="text"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                placeholder="e.g. PH100010"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Reason (optional)" htmlFor="merge-reason">
              <input
                id="merge-reason"
                type="text"
                value={mergeReason}
                onChange={(e) => setMergeReason(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
          {workbenchError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
            >
              {workbenchError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setMergeOpen(false)}
              disabled={workbenchBusy}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={workbenchBusy || !mergeTarget.trim()}
            >
              Merge
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
