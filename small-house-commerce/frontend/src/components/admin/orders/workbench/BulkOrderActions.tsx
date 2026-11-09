"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminOrderListRow,
  type BulkOrderAction,
  type BulkOrderResult,
} from "@/lib/admin-api";
import { buildPackingSlipsHtml } from "./packing-slip";

type Status = Extract<BulkOrderAction, { action: "status" }>["status"];
const STATUSES: Status[] = [
  "PENDING",
  "QUESTION",
  "ABNORMAL",
  "DENIED",
  "AFTER_SALES",
];

export function BulkOrderActions({
  rows,
  assignees,
  hasPermission,
  onDone,
}: {
  rows: AdminOrderListRow[];
  assignees: { id: string; name: string | null }[];
  hasPermission: (permission: string) => boolean;
  onDone: () => void;
}) {
  const { t } = useAdminI18n();
  const [action, setAction] = useState<BulkOrderAction["action"] | null>(null);
  const [assignedToId, setAssignedToId] = useState("");
  const [status, setStatus] = useState<Status>("PENDING");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    results: BulkOrderResult[];
    numbers: Record<string, string>;
  } | null>(null);

  async function execute() {
    if (!action || rows.length === 0 || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const ids = rows.map((row) => row.id);
    const input: BulkOrderAction =
      action === "assign"
        ? { action, ids, assignedToId }
        : action === "status"
          ? { action, ids, status }
          : { action, ids };
    const numbers = Object.fromEntries(
      rows.map((row) => [row.id, row.orderNumber]),
    );
    try {
      const response = await adminApi.bulkOrders(input);
      setResult({ ...response, numbers });
      setAction(null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("orders_load_error"));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function print() {
    const popup = window.open("", "_blank", "width=820,height=900");
    if (!popup) {
      setError(t("orders_packing_slip_popup_blocked"));
      return;
    }
    popup.opener = null;
    popup.document.write(buildPackingSlipsHtml(rows));
    popup.document.close();
    popup.focus();
    window.setTimeout(() => {
      if (!popup.closed) popup.print();
    }, 100);
  }

  if (rows.length === 0 && !result) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3 text-sm">
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-ink-secondary">
            {t("orders_bulk_selected", { count: rows.length })}
          </span>
          {hasPermission("ORDER_CONFIRM") ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAction("confirm")}
              disabled={busy}
            >
              {t("orders_bulk_confirm")}
            </Button>
          ) : null}
          {hasPermission("ORDER_ASSIGN") ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAction("assign")}
              disabled={busy}
            >
              {t("orders_bulk_assign")}
            </Button>
          ) : null}
          {hasPermission("ORDER_CANCEL") ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAction("cancel")}
              disabled={busy}
            >
              {t("orders_bulk_cancel")}
            </Button>
          ) : null}
          {hasPermission("ORDER_CONFIRM") ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAction("status")}
              disabled={busy}
            >
              {t("orders_bulk_status")}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={print} disabled={busy}>
            {t("orders_bulk_print")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sale">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-3">
            <p role="status">
              {t("orders_bulk_result", {
                ok: result.results.filter((r) => r.ok).length,
                failed: result.results.filter((r) => !r.ok).length,
              })}
            </p>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-xs text-ink-muted hover:underline"
            >
              {t("orders_bulk_dismiss")}
            </button>
          </div>
          <ul className="mt-1 max-h-40 overflow-auto text-xs text-ink-secondary">
            {result.results.map((r) => (
              <li key={r.id} className="py-0.5">
                {result.numbers[r.id] ?? r.id} ·{" "}
                {r.ok
                  ? t("orders_bulk_success")
                  : (r.error ?? t("orders_load_error"))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Dialog
        open={action !== null}
        onClose={() => {
          if (!busy) setAction(null);
        }}
        title={t("orders_bulk_title")}
        width="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">
            {t("orders_bulk_scope", { count: rows.length })}
          </p>
          {action === "cancel" ? (
            <p className="text-sm text-sale">
              {t("orders_dialog_cancel_hint")}
            </p>
          ) : null}
          {action === "confirm" ? (
            <p className="text-sm text-ink-secondary">
              {t("orders_bulk_risk_hint")}
            </p>
          ) : null}
          {action === "assign" ? (
            <label className="block text-sm">
              {t("orders_bulk_assign_to")}
              <select
                aria-label={t("orders_bulk_assign_to")}
                className="mt-1 w-full rounded-lg border border-border bg-card p-2"
                value={assignedToId}
                onChange={(e) => setAssignedToId(e.target.value)}
                disabled={busy}
              >
                <option value="">—</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {action === "status" ? (
            <label className="block text-sm">
              {t("orders_bulk_status")}
              <select
                aria-label={t("orders_bulk_status")}
                className="mt-1 w-full rounded-lg border border-border bg-card p-2"
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
                disabled={busy}
              >
                {STATUSES.filter(
                  (s) => s !== "DENIED" || hasPermission("ORDER_CANCEL"),
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              size="md"
              variant="secondary"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              {t("orders_cancel")}
            </Button>
            <Button
              size="md"
              disabled={
                busy ||
                rows.length === 0 ||
                (action === "assign" && !assignedToId)
              }
              onClick={() => void execute()}
            >
              {busy ? "…" : t("orders_bulk_execute")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
