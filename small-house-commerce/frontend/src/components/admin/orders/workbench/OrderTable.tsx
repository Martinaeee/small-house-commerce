"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Badge } from "@/components/admin/Badge";
import {
  type AdminOrderListRow,
} from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  MIN_COLUMN_WIDTH,
  stickyLeftOffsets,
  type WorkbenchColumn,
  type WorkbenchColumnKey,
} from "./columns";
import {
  peso,
  pesoExact,
  shortDateTime,
  waitingAge,
  waitingTone,
  waitingToneClass,
} from "./format";

export interface OrderTableProps {
  rows: AdminOrderListRow[];
  columns: WorkbenchColumn[];
  widths: Record<string, number>;
  onWidthChange: (key: WorkbenchColumnKey, width: number) => void;
  onResetWidth: (key: WorkbenchColumnKey) => void;
  expanded: ReadonlySet<string>;
  onToggleExpand: (orderId: string) => void;
  staffName: (id: string | null | undefined) => string | null;
  onOpenDrawer: (row: AdminOrderListRow) => void;
  onOpenVerify: (row: AdminOrderListRow) => void;
  onOpenHistory: (row: AdminOrderListRow) => void;
  onOpenCustomer: (row: AdminOrderListRow) => void;
  onOpenMenu: (event: ReactMouseEvent<HTMLButtonElement>, row: AdminOrderListRow) => void;
  /** The label of the primary action of a row, chosen by the state machine. */
  primaryAction: (row: AdminOrderListRow) => { label: string; tone: "primary" | "secondary" };
  busyOrderId?: string | null;
}

/** How long the order has been waiting, in the words the queue uses. */
export function waitingLabel(createdAt: string, now: number = Date.now()): string {
  return waitingAge(createdAt, now);
}

function ProductThumb({ src }: { src?: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded shared asset.
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-8 w-8 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-ink-muted"
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 19h18M6 19v-6h12v6M8 13V8.5h8V13" />
      </svg>
    </span>
  );
}

export function OrderTable({
  rows,
  columns,
  widths,
  onWidthChange,
  onResetWidth,
  expanded,
  onToggleExpand,
  staffName,
  onOpenDrawer,
  onOpenVerify,
  onOpenHistory,
  onOpenCustomer,
  onOpenMenu,
  primaryAction,
  busyOrderId,
}: OrderTableProps) {
  const { t } = useAdminI18n();
  const dragRef = useRef<{ key: WorkbenchColumnKey; startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    function move(event: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const width = Math.max(
        MIN_COLUMN_WIDTH,
        Math.round(drag.startWidth + (event.clientX - drag.startX)),
      );
      onWidthChange(drag.key, width);
    }
    function up() {
      dragRef.current = null;
      document.body.style.removeProperty("user-select");
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onWidthChange]);

  const widthOf = (column: WorkbenchColumn): number =>
    widths[column.key] ?? column.width;

  const totalWidth = useMemo(
    () => columns.reduce((sum, column) => sum + widthOf(column), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, widths],
  );
  const offsets = useMemo(
    () => stickyLeftOffsets(columns, widths),
    [columns, widths],
  );
  // The expanded row starts behind the frozen columns, so its content needs
  // the width of those columns as a left offset.
  const frozenWidth = useMemo(
    () =>
      columns
        .filter((column) => column.sticky === "left" || column.sticky === "left2")
        .reduce((sum, column) => sum + widthOf(column), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, widths],
  );

  function startResize(event: ReactMouseEvent<HTMLSpanElement>, column: WorkbenchColumn) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      key: column.key,
      startX: event.clientX,
      startWidth: widthOf(column),
    };
    document.body.style.setProperty("user-select", "none");
  }

  return (
    <div
      className="overflow-auto rounded-xl border border-border bg-card"
      style={{ maxHeight: "calc(100vh - 320px)" }}
    >
      <table
        className="border-separate border-spacing-0 text-[13px] table-fixed"
        style={{ width: totalWidth, minWidth: totalWidth }}
      >
        <caption className="sr-only">{t("orders_title")}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: widthOf(column) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => {
              const sticky = column.sticky;
              const offset = sticky === "right" ? undefined : offsets[column.key];
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={{
                    width: widthOf(column),
                    ...(offset !== undefined ? { left: offset } : {}),
                  }}
                  className={[
                    "sticky top-0 z-20 border-b border-border bg-background px-3 py-2 text-left text-[11.5px] font-semibold text-ink-muted",
                    sticky ? "z-30" : "",
                    column.align === "right" ? "text-right" : "",
                  ].join(" ")}
                >
                  <span className="inline-flex items-center gap-1">
                    {t(column.labelKey)}
                    <span
                      role="separator"
                      aria-label={t("orders_col_resize")}
                      title={t("orders_col_resize")}
                      onMouseDown={(event) => startResize(event, column)}
                      onDoubleClick={() => onResetWidth(column.key)}
                      className="ml-1 inline-block h-3.5 w-1 cursor-col-resize rounded-sm bg-border hover:bg-ink-muted"
                    />
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const first = row.items[0];
            const qty = row.items.reduce((sum, item) => sum + item.quantity, 0);
            const prices = row.items.map((item) => Number(item.unitPrice));
            const sameUnit = prices.every((price) => price === prices[0]);
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
            const action = primaryAction(row);
            const isExpanded = expanded.has(row.id);
            const risk = row.riskFlags[0];

            return (
              <Fragment key={row.id}>
                <tr
                  className="group border-b border-border hover:bg-primary-light/20"
                >
                  {columns.map((column) => {
                    const sticky = column.sticky;
                    const offset = sticky === "right" ? undefined : offsets[column.key];
                    const cellClass = [
                      "overflow-hidden px-3 py-[9px] align-middle text-ink-secondary",
                      sticky === "right" ? "sticky right-0 z-10 bg-card" : "",
                      sticky === "left" || sticky === "left2"
                        ? "sticky z-10 bg-card hover:bg-primary-light/20"
                        : "",
                      column.align === "right" ? "text-right" : "",
                    ].join(" ");

                    let content: React.ReactNode = null;
                    switch (column.key) {
                      case "no":
                        content = (
                          <button
                            type="button"
                            onClick={() => onOpenDrawer(row)}
                            className="font-semibold text-cta hover:underline"
                          >
                            {row.orderNumber}
                          </button>
                        );
                        break;
                      case "customer":
                        content = (
                          <div className="min-w-0">
                            <div className="truncate text-ink" title={row.customer.name ?? ""}>
                              {row.customer.name ?? "—"}
                            </div>
                            <div className="truncate text-[11.5px] text-ink-muted">
                              {row.customerClassification === "NEW"
                                ? t("orders_class_new")
                                : row.customerClassification === "AGAIN"
                                  ? t("orders_class_again")
                                  : row.customerClassification === "RPT"
                                    ? t("orders_class_rpt")
                                    : row.customerClassification === "RECHECK"
                                      ? t("orders_class_recheck")
                                      : "—"}
                            </div>
                          </div>
                        );
                        break;
                      case "phone":
                        content = (
                          <button
                            type="button"
                            onClick={() => onOpenCustomer(row)}
                            title={t("orders_phone_history_hint")}
                            className="whitespace-nowrap text-[13px] font-medium text-cta hover:underline"
                          >
                            {row.customer.normalizedPhone}
                          </button>
                        );
                        break;
                      case "status":
                        content = (
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge value={row.orderStatus} className="text-[11.5px]" />
                              {row.confirmationStatus === "NEEDS_REVIEW" ||
                              row.confirmationStatus === "REJECTED" ? (
                                <Badge
                                  value={row.confirmationStatus}
                                  className="text-[11.5px]"
                                />
                              ) : null}
                            </div>
                            {row.verification?.total ? (
                              <div className="mt-0.5 text-[11.5px] text-ink-muted">
                                {t("orders_verify_progress")} {row.verification.done}/
                                {row.verification.total} ·{" "}
                                {row.verification.pending + row.verification.problem}{" "}
                                {t("orders_verify_todo")}
                              </div>
                            ) : null}
                            {risk ? (
                              <div
                                className="mt-0.5 truncate text-[11.5px] font-semibold text-admin-error"
                                title={risk.reason ?? risk.flagType}
                              >
                                ⚠ {risk.flagType}
                              </div>
                            ) : null}
                          </div>
                        );
                        break;
                      case "product":
                        content = (
                          <div className="flex items-center gap-2">
                            <ProductThumb src={first?.thumbnailUrl} />
                            <div className="min-w-0">
                              <div
                                className="truncate text-[13px] font-medium text-ink"
                                title={first?.productNameSnapshot ?? ""}
                              >
                                {first?.productNameSnapshot ?? "—"}
                              </div>
                              {row.items.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => onToggleExpand(row.id)}
                                  className="text-[12px] font-medium text-cta hover:underline"
                                >
                                  {isExpanded
                                    ? t("orders_expand_collapse")
                                    : `${t("orders_expand")} ${row.items.length - 1} ${t("orders_skus_multi")}`}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                        break;
                      case "sku":
                        content =
                          row.items.length > 1 ? (
                            <div className="min-w-0">
                              <span className="text-[11.5px] text-ink-secondary">
                                {row.items.length} {t("orders_skus_multi")}
                              </span>
                              <div className="text-[11.5px] text-ink-muted">
                                {t("orders_expand_hint")}
                              </div>
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <div className="truncate font-mono text-[11.5px] text-ink">
                                {first?.skuCodeSnapshot ?? "—"}
                              </div>
                              <div className="truncate text-[11.5px] text-ink-muted">
                                {first?.variantSnapshot ?? ""}
                              </div>
                            </div>
                          );
                        break;
                      case "qty":
                        content = (
                          <span title={t("orders_qty_total_hint")}>{qty}</span>
                        );
                        break;
                      case "unit":
                        content = sameUnit ? (
                          <span className="tabular-nums">
                            {peso(first?.unitPrice)}
                          </span>
                        ) : (
                          <span
                            className="tabular-nums"
                            title={t("orders_unit_range_hint")}
                          >
                            {peso(Math.min(...prices).toFixed(2))} –{" "}
                            {peso(Math.max(...prices).toFixed(2))}
                          </span>
                        );
                        break;
                      case "total":
                        content = (
                          <div className="whitespace-nowrap">
                            <div className="font-semibold tabular-nums text-ink">
                              {peso(row.grandTotal)}
                            </div>
                            {Number(row.discountTotal) > 0 ? (
                              <div className="text-[11.5px] tabular-nums text-admin-success">
                                {t("orders_discount")} −{peso(row.discountTotal)}
                              </div>
                            ) : null}
                            <div className="text-[11.5px] text-ink-muted">
                              {row.paymentStatus}
                            </div>
                          </div>
                        );
                        break;
                      case "ship":
                        content = (
                          <span
                            className="whitespace-nowrap text-ink-muted"
                            title={t("orders_ship_cost_hint")}
                          >
                            {t("orders_ship_cost_pending")}
                          </span>
                        );
                        break;
                      case "at":
                        content = (
                          <div className="whitespace-nowrap">
                            <div className="text-ink-secondary">
                              {shortDateTime(row.createdAt)}
                            </div>
                            <div
                              className={`text-[11.5px] ${waitingToneClass(waitingTone(row.createdAt))}`}
                            >
                              ⏱ {waitingAge(row.createdAt)}
                            </div>
                          </div>
                        );
                        break;
                      case "note":
                        content = (
                          <div
                            className="truncate"
                            title={row.customerNote ?? undefined}
                          >
                            {row.customerNote ?? "—"}
                          </div>
                        );
                        break;
                      case "address":
                        content = (
                          <div className="truncate" title={address}>
                            {address || "—"}
                          </div>
                        );
                        break;
                      case "region":
                        content = (
                          <div className="min-w-0">
                            <div className="truncate">
                              {row.shippingAddress?.city ?? "—"}
                            </div>
                            <div className="truncate text-[11.5px] text-ink-muted">
                              {row.shippingAddress?.province ?? ""}
                            </div>
                          </div>
                        );
                        break;
                      case "history":
                        content = (
                          <button
                            type="button"
                            onClick={() => onOpenHistory(row)}
                            className="whitespace-nowrap text-[12.5px] font-medium text-cta hover:underline"
                          >
                            {t("orders_col_history")}
                          </button>
                        );
                        break;
                      case "owner":
                        content = (
                          <div className="min-w-0">
                            <div className="truncate">
                              {row.verification?.assigneeId
                                ? (staffName(row.verification.assigneeId) ?? "—")
                                : (row.assignedTo?.name ?? "—")}
                            </div>
                            {row.verification?.priority ? (
                              <div className="text-[11.5px] text-ink-muted">
                                {row.verification.priority === "URGENT"
                                  ? t("orders_priority_urgent")
                                  : row.verification.priority === "HIGH"
                                    ? t("orders_priority_high")
                                    : t("orders_priority_normal")}
                              </div>
                            ) : null}
                          </div>
                        );
                        break;
                      case "actions":
                        content = (
                          <div className="whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (row.orderStatus === "NEW" || row.orderStatus === "PENDING") {
                                    onOpenVerify(row);
                                  } else {
                                    onOpenDrawer(row);
                                  }
                                }}
                                disabled={busyOrderId === row.id}
                                className={
                                  action.tone === "primary"
                                    ? "rounded-lg bg-cta px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-cta-hover disabled:opacity-50"
                                    : "rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] font-semibold text-ink-secondary hover:bg-background"
                                }
                              >
                                {action.label}
                              </button>
                              <button
                                type="button"
                                aria-label={t("orders_actions_more")}
                                onClick={(event) => onOpenMenu(event, row)}
                                className="rounded-lg border border-border bg-card px-1.5 py-0.5 text-[12.5px] text-ink-secondary hover:bg-background"
                              >
                                ⋯
                              </button>
                            </div>
                          </div>
                        );
                        break;
                      default:
                        content = null;
                    }

                    return (
                      <td
                        key={column.key}
                        style={
                          offset !== undefined
                            ? { left: offset }
                            : undefined
                        }
                        className={cellClass}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
                {isExpanded ? (
                  <tr className="bg-background">
                    <td colSpan={columns.length} className="px-4 py-3">
                      <div
                        className="flex flex-wrap items-start gap-6"
                        style={{ paddingLeft: frozenWidth }}
                      >
                        <div className="w-[560px] max-w-full space-y-3">
                          {row.items.map((item) => (
                            <div key={item.id} className="flex items-start gap-2">
                              <ProductThumb src={item.thumbnailUrl} />
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-medium text-ink" title={item.productNameSnapshot}>
                                  {item.productNameSnapshot}
                                </div>
                                <div className="text-[11.5px] text-ink-muted">
                                  <span className="font-mono">{item.skuCodeSnapshot}</span>
                                  {item.variantSnapshot ? ` · ${item.variantSnapshot}` : ""}
                                </div>
                                <div className="text-[11.5px] tabular-nums text-ink-secondary">
                                  {peso(item.unitPrice)} × {item.quantity} ={" "}
                                  <b>{peso(item.lineTotal)}</b>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="w-64 shrink-0 rounded-lg border border-border bg-card p-3 text-[12.5px]">
                          <div className="flex items-center justify-between py-1">
                            <span className="text-ink-secondary">
                              {t("orders_subtotal")}
                            </span>
                            <span className="tabular-nums">{peso(row.subtotal)}</span>
                          </div>
                          {Number(row.discountTotal) > 0 ? (
                            <div className="flex items-center justify-between py-1">
                              <span className="text-ink-secondary">{t("orders_discount")}</span>
                              <span className="tabular-nums text-admin-success">
                                −{peso(row.discountTotal)}
                              </span>
                            </div>
                          ) : null}
                          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-[13.5px] font-bold text-ink">
                            <span>{t("orders_col_total")}</span>
                            <span className="tabular-nums">{pesoExact(row.grandTotal)}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
