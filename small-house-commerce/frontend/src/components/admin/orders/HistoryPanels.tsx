"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/admin/Badge";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminCustomerOrderHistory,
  type AdminOrderDetail,
  type AdminVerificationState,
} from "@/lib/admin-api";
import { fullDateTime, peso, shortDateTime } from "./workbench/format";
import { useCustomerHistory } from "./workbench/useCustomerHistory";

/**
 * The two history surfaces of the workbench:
 *   - CustomerHistoryDialog: every order of one phone number, with the
 *     signature rate the handler needs to judge the customer
 *   - OrderHistoryDialog: the processing history of one order - what
 *     changed, who changed it and why - and, in the same window, the other
 *     orders of the same phone number
 *
 * Both only show facts that are stored: the status history, the notes, the
 * risk flags, the verification events, the shipments and the payments.
 */

type HistoryCategory = "全部" | "订单状态" | "核实" | "客户通知" | "风险" | "物流" | "COD";

const CATEGORY_KEYS: Record<HistoryCategory, TKey> = {
  全部: "history_cat_all",
  订单状态: "history_cat_order",
  核实: "history_cat_verify",
  客户通知: "history_cat_customer",
  风险: "history_cat_risk",
  物流: "history_cat_logistics",
  COD: "history_cat_cod",
};

const CATEGORIES = Object.keys(CATEGORY_KEYS) as HistoryCategory[];

/** The verification statuses and events, in the words the operator uses. */
const VERIFICATION_STATUS_KEYS: Record<string, TKey> = {
  PENDING: "verify_status_pending",
  DONE: "verify_status_done",
  PROBLEM: "verify_status_problem",
  SKIPPED: "verify_status_skipped",
  INVALIDATED: "verify_status_invalidated",
};

const VERIFICATION_EVENT_KEYS: Record<string, TKey> = {
  ASSIGNED: "verify_assign_title",
  REASSIGNED: "verify_drawer_assign",
  RESULT_SET: "verify_drawer_status",
  CONTACT_ATTEMPT: "verify_drawer_note",
  NOTE: "verify_drawer_note",
  NEXT_FOLLOW_UP: "verify_assign_note",
  INVALIDATED: "verify_status_invalidated",
  SKIPPED: "verify_status_skipped",
};

const label = (t: (key: TKey) => string, value: string | null | undefined): string => {
  if (!value) return "—";
  const statusKey = VERIFICATION_STATUS_KEYS[value];
  if (statusKey) return t(statusKey);
  const eventKey = VERIFICATION_EVENT_KEYS[value];
  if (eventKey) return t(eventKey);
  return value;
};

interface HistoryRow {
  at: string;
  from: string;
  to: string;
  by: string;
  note: string;
  category: HistoryCategory;
}

/* ------------------------------------------------------------------ */
/* The customer order history                                          */
/* ------------------------------------------------------------------ */

export function CustomerHistoryDialog({
  phone,
  currentOrderNumber,
  open,
  onClose,
  onFilterByPhone,
}: {
  phone: string | null;
  /** The order the operator came from - marked in the list. */
  currentOrderNumber?: string | null;
  open: boolean;
  onClose: () => void;
  /** Push the phone number into the filter bar of the list. */
  onFilterByPhone?: (phone: string) => void;
}) {
  const { t } = useAdminI18n();
  const { data, loading, error } = useCustomerHistory(phone, open);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${t("history_customer_title")} · ${phone ?? ""}`}
      width="lg"
    >
      {error ? (
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
          {error}
        </p>
      ) : null}
      {loading && !data ? (
        <p className="text-[13px] text-ink-muted">{t("history_loading")}</p>
      ) : null}
      {data ? (
        <div className="space-y-4">
          {/* Who this customer is and what the numbers mean. */}
          <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card p-3">
            <div>
              <p className="text-[11px] text-ink-muted">{t("orders_customer")}</p>
              <p className="text-[15px] font-semibold text-ink">
                {data.customerName ?? "—"}
                {data.customerClassification ? (
                  <span className="ml-2 inline-flex items-center rounded-full bg-admin-neutral-soft px-2 py-0.5 text-[11.5px] font-semibold text-ink-secondary">
                    {data.customerClassification}
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-muted">{t("orders_phone")}</p>
              <p className="text-[13px] font-semibold text-ink">{data.phone}</p>
            </div>
            {currentOrderNumber ? (
              <div>
                <p className="text-[11px] text-ink-muted">{t("history_current_order")}</p>
                <p className="text-[13px] font-semibold text-ink">
                  {currentOrderNumber}
                </p>
              </div>
            ) : null}
            <p className="min-w-[220px] flex-1 text-[11px] leading-relaxed text-ink-muted">
              {t("history_customer_note")}
            </p>
            {onFilterByPhone ? (
              <button
                type="button"
                onClick={() => onFilterByPhone(data.phone)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-background"
              >
                {t("history_filter_by_phone")}
              </button>
            ) : null}
          </div>

          {/* The seven numbers of the customer. */}
          <div className="flex overflow-hidden rounded-xl border border-border bg-card">
            <Stat label={t("history_all_orders")} value={String(data.total)} />
            <Stat label={t("history_signed")} value={String(data.signed)} tone="text-admin-success" />
            <Stat
              label={t("history_signature_rate")}
              value={`${data.rate}%`}
              tone={data.rate >= 60 ? "text-admin-success" : data.rate ? "text-admin-warning" : "text-admin-error"}
            />
            <Stat label={t("history_shipping")} value={String(data.shipping)} />
            <Stat label={t("history_open")} value={String(data.open)} tone="text-admin-warning" />
            <Stat label={t("history_cancelled")} value={String(data.cancelled)} tone="text-admin-error" />
            <Stat label={t("history_total_value")} value={peso(data.value)} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-background text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2">{t("orders_order_number")}</th>
                  <th className="px-3 py-2">{t("orders_created")}</th>
                  <th className="px-3 py-2">{t("history_col_goods")}</th>
                  <th className="px-3 py-2 text-right">{t("orders_col_total")}</th>
                  <th className="px-3 py-2">{t("orders_order_status")}</th>
                  <th className="px-3 py-2">{t("history_fulfilment")}</th>
                  <th className="px-3 py-2">{t("history_col_owner")}</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-semibold text-ink">
                      {order.orderNumber}
                      {order.orderNumber === currentOrderNumber ? (
                        <div className="text-[11px] text-ink-muted">
                          {t("history_current_marker")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-secondary">
                      {fullDateTime(order.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[250px] truncate text-ink">
                        {order.items.map((item) => item.productNameSnapshot).join("、")}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {order.items.map((item) => item.skuCodeSnapshot).join("、")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {peso(order.grandTotal)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge value={order.orderStatus} className="text-[11.5px]" />
                    </td>
                    <td className="px-3 py-2">{fulfilment(t, order.orderStatus, order.riskFlags.length > 0)}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {order.ownerName ?? <span className="text-ink-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex-1 border-r border-border px-3 py-2 last:border-r-0">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className={`text-[19px] font-semibold tabular-nums ${tone ?? "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

/** How the order ended up - the words the queue uses, not the enum. */
function fulfilment(
  t: (key: TKey) => string,
  orderStatus: string,
  hasRisk: boolean,
): React.ReactNode {
  if (orderStatus === "SIGNED") {
    return <span className="text-admin-success">{t("history_fulfil_signed")}</span>;
  }
  if (orderStatus === "RETURNED") {
    return <span className="text-admin-error">{t("history_fulfil_returned")}</span>;
  }
  if (orderStatus === "PARTIALLY_RETURNED") {
    return t("history_fulfil_partially_returned");
  }
  if (orderStatus === "SHIPPING") {
    return hasRisk ? (
      <span className="text-admin-error">{t("history_fulfil_exception")}</span>
    ) : (
      t("history_fulfil_shipping")
    );
  }
  if (orderStatus === "CANCELLED") {
    return <span className="text-ink-muted">{t("history_fulfil_cancelled")}</span>;
  }
  if (orderStatus === "CONFIRMED") return t("history_fulfil_confirmed");
  return t("history_fulfil_unshipped");
}

/* ------------------------------------------------------------------ */
/* The processing history of one order                                 */
/* ------------------------------------------------------------------ */

export function OrderHistoryDialog({
  orderId,
  open,
  onClose,
  staff,
  onOpenPhoneHistory,
  onOpenOrder,
}: {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  staff: { id: string; name: string | null }[];
  /** Open the customer history of the phone number of this order. */
  onOpenPhoneHistory?: (phone: string) => void;
  /** Open one of the other orders of the same customer. */
  onOpenOrder?: (orderId: string) => void;
}) {
  const { t } = useAdminI18n();
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [verification, setVerification] = useState<AdminVerificationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<HistoryCategory>("全部");
  const phone = detail?.customer?.normalizedPhone ?? null;
  const { data: customer } = useCustomerHistory(phone, open);

  const nameOf = useCallback(
    (id: string | null | undefined) => {
      if (!id) return t("history_system_actor");
      // An operator we cannot resolve is shown as unknown - never as a raw id.
      return staff.find((s) => s.id === id)?.name ?? t("history_unknown_actor");
    },
    [staff, t],
  );

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    void Promise.all([
      adminApi.getOrder(orderId),
      adminApi.orderVerification(orderId).catch(() => null),
    ])
      .then(([order, verificationState]) => {
        if (cancelled) return;
        setDetail(order);
        setVerification(verificationState);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("common_request_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  const rows = useMemo<HistoryRow[]>(() => {
    if (!detail) return [];
    const list: HistoryRow[] = [];
    for (const entry of detail.statusHistory ?? []) {
      list.push({
        at: entry.createdAt,
        from: entry.oldStatus ?? "—",
        to: entry.newStatus ?? "—",
        by: entry.operatorName ?? nameOf(entry.operatorId),
        note: entry.comment ?? "",
        category: "订单状态",
      });
    }
    for (const note of detail.notes ?? []) {
      list.push({
        at: note.createdAt,
        from: "—",
        to: note.noteType,
        by: note.operatorName ?? nameOf(note.userId),
        note: note.content,
        category: note.noteType === "WAREHOUSE" ? "物流" : note.noteType === "CUSTOMER_SERVICE" ? "客户通知" : "订单状态",
      });
    }
    for (const flag of detail.riskFlags ?? []) {
      list.push({
        at: flag.createdAt,
        from: "—",
        to: flag.resolved ? `${flag.flagType}${t("history_risk_resolved_suffix")}` : flag.flagType,
        by: nameOf(flag.createdBy),
        note: flag.reason ?? "",
        category: "风险",
      });
    }
    for (const event of verification?.events ?? []) {
      list.push({
        at: event.createdAt,
        from: label(t, event.fromStatus),
        to: label(t, event.toStatus ?? event.type),
        by: nameOf(event.operatorId),
        note: [event.result, event.note].filter(Boolean).join(" — "),
        category: "核实",
      });
    }
    for (const shipment of detail.shipments ?? []) {
      list.push({
        at: shipment.shippedAt ?? shipment.createdAt,
        from: "—",
        to: shipment.status,
        by: t("history_actor_warehouse"),
        note: `${shipment.carrier}${shipment.trackingNumber ? ` ${shipment.trackingNumber}` : ""}`,
        category: "物流",
      });
    }
    for (const payment of detail.payments ?? []) {
      list.push({
        at: payment.createdAt,
        from: "—",
        to: payment.status,
        by: t("history_system_actor"),
        note: `${payment.method} ${peso(payment.amount)}`,
        category: "COD",
      });
    }
    return list.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [detail, verification, nameOf, t]);

  const visible = category === "全部" ? rows : rows.filter((r) => r.category === category);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${t("orders_col_history")} · ${detail?.orderNumber ?? ""}`}
      width="lg"
    >
      {error ? (
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
          {error}
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2">
        {CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategory(value)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${
              category === value
                ? "border-transparent bg-admin-primary-soft font-semibold text-ink"
                : "border-border bg-card text-ink-secondary hover:bg-background"
            }`}
          >
            {t(CATEGORY_KEYS[value])}
            {value === "全部" ? ` (${rows.length})` : ` (${rows.filter((r) => r.category === value).length})`}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-background text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2">{t("history_col_time")}</th>
              <th className="px-3 py-2">{t("history_col_from")}</th>
              <th className="px-3 py-2">{t("history_col_to")}</th>
              <th className="px-3 py-2">{t("history_col_by")}</th>
              <th className="px-3 py-2">{t("history_col_note")}</th>
              <th className="px-3 py-2">{t("history_col_category")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={`${row.at}-${index}`} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 whitespace-nowrap text-ink-secondary">
                  {shortDateTime(row.at)}
                </td>
                <td className="px-3 py-2 text-ink-muted">{row.from}</td>
                <td className="px-3 py-2 font-semibold text-ink">{row.to}</td>
                <td className="px-3 py-2 text-ink-secondary">{row.by}</td>
                <td className="px-3 py-2 text-ink-secondary">{row.note || "—"}</td>
                <td className="px-3 py-2">
                  <span className="rounded border border-border px-1 text-[10.5px] font-bold text-ink-muted">
                    {row.category}
                  </span>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[13px] text-ink-muted">
                  {t("history_empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* The other orders of the same customer, in the same window. */}
      {customer ? (
        <CustomerHistoryBlock
          customer={customer}
          currentOrderNumber={detail?.orderNumber ?? null}
          onOpenPhoneHistory={onOpenPhoneHistory}
          onOpenOrder={onOpenOrder}
        />
      ) : null}
    </Dialog>
  );
}

/** The customer history of one phone number, as the history modal shows it. */
export function CustomerHistoryBlock({
  customer,
  currentOrderNumber,
  onOpenPhoneHistory,
  onOpenOrder,
}: {
  customer: AdminCustomerOrderHistory;
  currentOrderNumber?: string | null;
  onOpenPhoneHistory?: (phone: string) => void;
  onOpenOrder?: (orderId: string) => void;
}) {
  const { t } = useAdminI18n();
  return (
    <section className="mt-4 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11.5px] font-bold uppercase tracking-[.06em] text-ink-muted">
          {t("history_phone_orders_title")}
        </h3>
        {onOpenPhoneHistory ? (
          <button
            type="button"
            onClick={() => onOpenPhoneHistory(customer.phone)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-background"
          >
            {t("history_phone_orders_open")}
          </button>
        ) : null}
      </div>
      <p className="mb-2 mt-1 text-[11px] text-ink-muted">
        {customer.phone} · {t("history_total_orders")} {customer.total} ·{" "}
        {t("history_signed")} {customer.signed} · {t("history_signature_rate")}{" "}
        {customer.rate}% · {t("history_cancelled")} {customer.cancelled}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-background text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2">{t("orders_order_number")}</th>
              <th className="px-3 py-2">{t("orders_created")}</th>
              <th className="px-3 py-2 text-right">{t("orders_col_total")}</th>
              <th className="px-3 py-2">{t("orders_order_status")}</th>
              <th className="px-3 py-2">{t("history_fulfilment")}</th>
            </tr>
          </thead>
          <tbody>
            {customer.orders.map((order) => (
              <tr key={order.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2">
                  {onOpenOrder ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrder(order.id)}
                      className="font-semibold text-cta hover:underline"
                    >
                      {order.orderNumber}
                    </button>
                  ) : (
                    <span className="font-semibold text-ink">{order.orderNumber}</span>
                  )}
                  {order.orderNumber === currentOrderNumber ? (
                    <div className="text-[11px] text-ink-muted">
                      {t("history_current_marker")}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-secondary">
                  {fullDateTime(order.createdAt)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {peso(order.grandTotal)}
                </td>
                <td className="px-3 py-2">
                  <Badge value={order.orderStatus} className="text-[11.5px]" />
                </td>
                <td className="px-3 py-2">
                  {fulfilment(t, order.orderStatus, order.riskFlags.length > 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
