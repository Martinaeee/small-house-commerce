"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/admin/Badge";
import {
  adminApi,
  type AdminOrderListRow,
  type AdminVerificationState,
} from "@/lib/admin-api";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { CustomerHistoryBlock } from "../HistoryPanels";
import {
  fullDateTime,
  peso,
  pesoExact,
  waitingAge,
} from "./format";
import { useCustomerHistory } from "./useCustomerHistory";

export type DrawerTab = "overview" | "verify" | "customer" | "goods" | "history";

export interface OrderDrawerProps {
  row: AdminOrderListRow | null;
  onClose: () => void;
  staff: { id: string; name: string | null }[];
  onOpenVerify: () => void;
  onOpenHistory: () => void;
  onOpenCustomer: () => void;
  onOpenOrder?: (orderId: string) => void;
  onAssign: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
  confirmBlockedReason: string | null;
}

const STATUS_KEY: Record<string, TKey> = {
  PENDING: "verify_status_pending",
  DONE: "verify_status_done",
  PROBLEM: "verify_status_problem",
  SKIPPED: "verify_status_skipped",
  INVALIDATED: "verify_status_invalidated",
};

/** The section heading of the drawer: small, quiet, uppercase. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-[.06em] text-ink-muted">
      {children}
    </h3>
  );
}

export function OrderDrawer({
  row,
  onClose,
  staff,
  onOpenVerify,
  onOpenHistory,
  onOpenCustomer,
  onOpenOrder,
  onAssign,
  onConfirm,
  canConfirm,
  confirmBlockedReason,
}: OrderDrawerProps) {
  const { t } = useAdminI18n();
  const [tab, setTab] = useState<DrawerTab>("overview");
  // The checklist belongs to one order: the id keeps a stale answer of the
  // previous order out of the drawer.
  const [verification, setVerification] = useState<{
    orderId: string;
    state: AdminVerificationState;
  } | null>(null);

  const orderId = row?.id ?? null;
  const phone = row?.customer?.normalizedPhone ?? null;
  const { data: customer } = useCustomerHistory(phone, tab === "customer");

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    adminApi
      .orderVerification(orderId)
      .then((state) => {
        if (active) setVerification({ orderId, state });
      })
      .catch(() => {
        // The checklist stays empty; the drawer shows the order facts.
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  useEffect(() => {
    if (!row) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [row, onClose]);

  if (!row) return null;

  const address = row.shippingAddress
    ? [
        row.shippingAddress.streetAddress,
        row.shippingAddress.barangay,
        row.shippingAddress.city,
        row.shippingAddress.province,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const items =
    verification && verification.orderId === orderId ? verification.state.items : [];
  const doneItems = items.filter(
    (item) => item.status === "DONE" || item.status === "SKIPPED",
  ).length;
  const openItems = items.filter(
    (item) => item.status === "PENDING" || item.status === "PROBLEM",
  ).length;
  const missing = items.filter(
    (item) => item.status === "PENDING" || item.status === "PROBLEM",
  );
  const risk = row.riskFlags[0];
  const ownerName = row.verification?.assigneeId
    ? (staff.find((person) => person.id === row.verification?.assigneeId)?.name ?? null)
    : (row.assignedTo?.name ?? null);
  const first = row.items[0];

  const nextStep = (() => {
    if (row.orderStatus === "CANCELLED" || row.orderStatus === "DENIED") {
      return t("orders_next_cancelled");
    }
    if (row.orderStatus === "SIGNED") return t("orders_next_signed");
    if (row.orderStatus === "SHIPPING") return t("orders_next_shipping");
    if (row.orderStatus === "CONFIRMED") return t("orders_next_confirmed");
    if (!row.verification?.total) return t("orders_next_no_owner");
    return t("orders_next_verify");
  })();

  const tabs: { key: DrawerTab; label: string }[] = [
    { key: "overview", label: t("orders_drawer_overview") },
    { key: "verify", label: t("orders_drawer_verify") },
    { key: "customer", label: t("orders_drawer_customer") },
    { key: "goods", label: t("orders_drawer_goods") },
    { key: "history", label: t("orders_drawer_history") },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t("orders_drawer_close")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={row.orderNumber}
        className="relative flex h-full w-[min(100vw,40rem)] flex-col border-l border-border bg-card shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-[18px] py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold text-ink">{row.orderNumber}</h2>
              <Badge value={row.orderStatus} className="text-[11.5px]" />
            </div>
            <p className="mt-1 text-[11.5px] text-ink-muted">
              {t("orders_created")}: {fullDateTime(row.createdAt)}（
              {waitingAge(row.createdAt)}） · {row.paymentMethod ?? row.paymentStatus}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("orders_drawer_close")}
            className="rounded-lg border border-border px-2 py-1 text-[13px] text-ink-secondary hover:bg-background"
          >
            ✕
          </button>
        </header>

        <nav className="flex gap-1 border-b border-border px-3" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              onClick={() => setTab(entry.key)}
              className={
                tab === entry.key
                  ? "border-b-2 border-cta px-3 py-2 text-[13px] font-semibold text-cta"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] text-ink-secondary hover:text-ink"
              }
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-[18px] py-4 text-[13px]">
          {tab === "overview" ? (
            <div className="space-y-4">
              <div
                className={
                  risk
                    ? "rounded-xl border border-admin-error/30 bg-admin-error-soft px-4 py-3"
                    : "rounded-xl border border-border bg-admin-primary-soft px-4 py-3"
                }
              >
                <div className="text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">
                  {t("orders_next_step")}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink">{nextStep}</p>
                {missing.length > 0 ? (
                  <p className="mt-2 text-[12.5px] text-ink-secondary">
                    {t("orders_verify_open_hint")} {missing.length}{" "}
                    {t("orders_verify_open_unit")} ——{" "}
                    {missing.map((item) => item.titleSnapshot).join("、")}
                  </p>
                ) : null}
                {risk ? (
                  <p className="mt-2 text-[13px] font-semibold text-admin-error">
                    ⛔ {t("orders_risk_unresolved")}: {risk.flagType}
                    {risk.reason ? ` — ${risk.reason}` : ""}
                  </p>
                ) : null}
              </div>

              {/* The order facts and the goods, side by side. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <section className="rounded-xl border border-border p-3">
                  <SectionTitle>{t("orders_drawer_overview")}</SectionTitle>
                  <dl className="grid grid-cols-[76px_1fr] gap-1.5 text-[13px]">
                    <dt className="text-[12.5px] text-ink-muted">{t("orders_customer")}</dt>
                    <dd className="text-ink">{row.customer.name ?? "—"}</dd>
                    <dt className="text-[12.5px] text-ink-muted">{t("orders_phone")}</dt>
                    <dd>
                      <button
                        type="button"
                        onClick={onOpenCustomer}
                        className="font-semibold text-cta hover:underline"
                      >
                        {row.customer.normalizedPhone}
                      </button>
                    </dd>
                    <dt className="text-[12.5px] text-ink-muted">
                      {t("orders_col_address")}
                    </dt>
                    <dd className="text-ink">
                      {address || "—"}
                      <div className="text-[11px] text-ink-muted">
                        {row.shippingAddress?.city}, {row.shippingAddress?.province}
                      </div>
                    </dd>
                    <dt className="text-[12.5px] text-ink-muted">
                      {t("orders_filter_payment")}
                    </dt>
                    <dd className="text-ink">
                      {row.paymentMethod ?? "—"} · {row.paymentStatus}
                    </dd>
                    <dt className="text-[12.5px] text-ink-muted">
                      {t("orders_filter_classification")}
                    </dt>
                    <dd className="text-ink">{row.customerClassification ?? "—"}</dd>
                  </dl>
                </section>

                <section className="rounded-xl border border-border p-3">
                  <SectionTitle>{t("orders_drawer_goods")}</SectionTitle>
                  <div className="text-[13px] font-medium text-ink">
                    {first?.productNameSnapshot ?? "—"}
                  </div>
                  <div className="text-[11.5px] text-ink-muted">
                    <span className="font-mono">{first?.skuCodeSnapshot ?? "—"}</span>
                  </div>
                  <div className="mt-2 border-t border-border pt-2 text-[12.5px]">
                    <SumRow
                      label={t("orders_subtotal")}
                      value={peso(row.subtotal)}
                    />
                    {Number(row.discountTotal) > 0 ? (
                      <SumRow
                        label={t("orders_discount")}
                        value={`−${peso(row.discountTotal)}`}
                        tone="text-admin-success"
                      />
                    ) : null}
                    <SumRow
                      label={t("orders_col_total")}
                      value={pesoExact(row.grandTotal)}
                      total
                    />
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-border p-3">
                <SectionTitle>{t("orders_drawer_owner")}</SectionTitle>
                <div className="text-[12.5px]">
                  <SumRow
                    label={t("orders_verify_progress")}
                    value={
                      items.length > 0
                        ? `${doneItems}/${items.length} · ${openItems} ${t("orders_verify_todo")}`
                        : t("orders_not_assigned")
                    }
                  />
                  <SumRow
                    label={t("orders_drawer_owner")}
                    value={ownerName ?? t("orders_unassigned")}
                  />
                  <SumRow
                    label={t("orders_next_follow_up")}
                    value={
                      row.verification?.nextFollowUpAt
                        ? fullDateTime(row.verification.nextFollowUpAt)
                        : "—"
                    }
                  />
                  <SumRow
                    label={t("orders_col_note")}
                    value={row.customerNote ?? "—"}
                  />
                </div>
                <button
                  type="button"
                  onClick={onAssign}
                  className="mt-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-background"
                >
                  {t("orders_assign_tasks")}
                </button>
              </section>

              {risk ? (
                <section className="rounded-xl border border-border p-3">
                  <SectionTitle>{t("orders_risk_unresolved")}</SectionTitle>
                  <p className="text-[13px] font-semibold text-admin-error">
                    {risk.flagType}
                  </p>
                  {risk.reason ? (
                    <p className="text-[11.5px] text-ink-muted">{risk.reason}</p>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "verify" ? (
            <div className="space-y-3">
              {items.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{t("orders_not_assigned")}</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li key={item.id} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] text-ink">{item.titleSnapshot}</span>
                        <span
                          className={`whitespace-nowrap text-[11.5px] font-semibold ${itemToneClass(item.status)}`}
                        >
                          {STATUS_KEY[item.status] ? t(STATUS_KEY[item.status]) : item.status}
                        </span>
                      </div>
                      {item.result ? (
                        <p className="mt-1 text-[11.5px] text-ink-secondary">{item.result}</p>
                      ) : null}
                      <p className="mt-1 text-[11.5px] text-ink-muted">
                        {item.operatorId
                          ? (staff.find((person) => person.id === item.operatorId)?.name ??
                            item.operatorId)
                          : t("orders_unassigned")}
                        {item.completedAt ? ` · ${fullDateTime(item.completedAt)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={onOpenVerify}
                className="rounded-lg bg-cta px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-cta-hover"
              >
                {t("orders_open_verify_panel")}
              </button>
            </div>
          ) : null}

          {tab === "customer" ? (
            <div className="space-y-3">
              <section className="rounded-xl border border-border p-3">
                <SectionTitle>{t("orders_drawer_customer")}</SectionTitle>
                <dl className="grid grid-cols-[76px_1fr] gap-1.5 text-[13px]">
                  <dt className="text-[12.5px] text-ink-muted">{t("orders_customer")}</dt>
                  <dd className="text-ink">{row.customer.name ?? "—"}</dd>
                  <dt className="text-[12.5px] text-ink-muted">
                    {t("orders_filter_classification")}
                  </dt>
                  <dd className="text-ink">{row.customerClassification ?? "—"}</dd>
                  <dt className="text-[12.5px] text-ink-muted">{t("orders_phone")}</dt>
                  <dd>
                    <button
                      type="button"
                      onClick={onOpenCustomer}
                      className="font-semibold text-cta hover:underline"
                    >
                      {row.customer.normalizedPhone}
                    </button>
                    <span className="text-[11px] text-ink-muted">
                      （{t("orders_phone_history_hint")}）
                    </span>
                  </dd>
                  <dt className="text-[12.5px] text-ink-muted">
                    {t("orders_col_address")}
                  </dt>
                  <dd className="text-ink">{address || "—"}</dd>
                  <dt className="text-[12.5px] text-ink-muted">{t("orders_risk_level")}</dt>
                  <dd className="text-ink">{row.customer.currentRiskLevel ?? "—"}</dd>
                  <dt className="text-[12.5px] text-ink-muted">{t("orders_col_note")}</dt>
                  <dd className="text-ink">{row.customerNote ?? "—"}</dd>
                </dl>
              </section>
              {customer ? (
                <CustomerHistoryBlock
                  customer={customer}
                  currentOrderNumber={row.orderNumber}
                  onOpenPhoneHistory={onOpenCustomer}
                  onOpenOrder={onOpenOrder}
                />
              ) : null}
            </div>
          ) : null}

          {tab === "goods" ? (
            <div className="space-y-3">
              <SectionTitle>{t("orders_drawer_goods")}</SectionTitle>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border bg-background text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2">{t("orders_col_product")}</th>
                      <th className="px-3 py-2">{t("orders_col_sku")}</th>
                      <th className="px-3 py-2">{t("orders_col_variant")}</th>
                      <th className="px-3 py-2 text-right">{t("orders_col_unit")}</th>
                      <th className="px-3 py-2 text-right">{t("orders_col_qty")}</th>
                      <th className="px-3 py-2 text-right">{t("orders_col_line_total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.items.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 text-ink">{item.productNameSnapshot}</td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-admin-neutral-soft px-1 font-mono text-[11.5px] text-ink-secondary">
                            {item.skuCodeSnapshot}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-secondary">
                          {item.variantSnapshot || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">
                          {peso(item.unitPrice)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">
                          {item.quantity}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">
                          {peso(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border border-border p-3 text-[12.5px]">
                <SumRow label={t("orders_subtotal")} value={peso(row.subtotal)} />
                {Number(row.discountTotal) > 0 ? (
                  <SumRow
                    label={t("orders_discount")}
                    value={`−${peso(row.discountTotal)}`}
                    tone="text-admin-success"
                  />
                ) : null}
                <SumRow
                  label={t("orders_col_total")}
                  value={pesoExact(row.grandTotal)}
                  total
                />
                {/* The shipping cost is an internal reference, kept apart from
                    the consumer totals: the real rate is not connected yet. */}
                <SumRow
                  label={t("orders_ship_cost_label")}
                  value={t("orders_ship_cost_pending")}
                  tone="text-ink-muted"
                  dashed
                />
              </div>
            </div>
          ) : null}

          {tab === "history" ? (
            <div className="space-y-3">
              <p className="text-[13px] text-ink-muted">{t("orders_history_drawer_hint")}</p>
              <button
                type="button"
                onClick={onOpenHistory}
                className="rounded-lg bg-cta px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-cta-hover"
              >
                {t("orders_col_history")}
              </button>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <button
            type="button"
            onClick={onAssign}
            className="rounded-lg border border-border px-3 py-2 text-[12.5px] font-semibold text-ink-secondary hover:bg-background"
          >
            {t("orders_assign_tasks")}
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="rounded-lg border border-border px-3 py-2 text-[12.5px] font-semibold text-ink-secondary hover:bg-background"
          >
            {t("orders_col_history")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-[12.5px] font-semibold text-ink-secondary hover:bg-background"
          >
            {t("orders_close")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            title={confirmBlockedReason ?? undefined}
            className="rounded-lg bg-cta px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("orders_verify_and_confirm")}
          </button>
        </footer>
      </aside>
    </div>
  );
}

/** One line of a summary block: a label on the left, the value on the right. */
function SumRow({
  label,
  value,
  tone,
  total,
  dashed,
}: {
  label: string;
  value: string;
  tone?: string;
  /** The total line: heavier and separated by a rule. */
  total?: boolean;
  /** The shipping cost line: a dashed rule, because it is not a consumer sum. */
  dashed?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-4 py-0.5",
        total
          ? "mt-1 border-t border-border pt-1.5 text-[13.5px] font-bold text-ink"
          : "text-ink-secondary",
        dashed ? "mt-2 border-t border-dashed border-border pt-2 text-ink-muted" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${tone ?? (total ? "text-ink" : "")}`}>{value}</span>
    </div>
  );
}

/** The color of a verification result, as the draft shows it. */
function itemToneClass(status: string): string {
  if (status === "DONE") return "text-admin-success";
  if (status === "PROBLEM") return "text-admin-error";
  if (status === "PENDING") return "text-admin-warning";
  if (status === "INVALIDATED") return "text-ink-secondary";
  return "text-ink-muted";
}
