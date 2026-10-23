"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminOrderListRow,
  type AdminOrderRow,
} from "@/lib/admin-api";
import { peso } from "./format";

export type RowDialogKind =
  | "confirm"
  | "cancel"
  | "note"
  | "risk"
  | "merge"
  | "print"
  | null;

export interface OrderRowDialogsProps {
  kind: RowDialogKind;
  row: AdminOrderListRow | null;
  onClose: () => void;
  /** Called after a successful write, so the list can reload. */
  onDone: (updated?: AdminOrderRow) => void;
}

const RISK_TYPES = ["POSSIBLE_DUPLICATE", "CUSTOMER_RECHECK", "CUSTOMER_BLOCKED"];

/**
 * The dialogs behind the row menu: confirm, cancel, note, risk flag, merge
 * and the packing slip. Every one of them calls the real endpoint - there is
 * no placeholder that pretends to work.
 */
export function OrderRowDialogs({ kind, row, onClose, onDone }: OrderRowDialogsProps) {
  const { t } = useAdminI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [riskType, setRiskType] = useState("CUSTOMER_RECHECK");
  const [riskReason, setRiskReason] = useState("");
  const [decision, setDecision] = useState<"CONFIRM" | "CANCEL" | "REQUEST_INFO">("CONFIRM");
  const [mergeNumber, setMergeNumber] = useState("");
  const [mergeCandidates, setMergeCandidates] = useState<AdminOrderListRow[]>([]);
  const [searching, setSearching] = useState(false);

  if (!kind || !row) return null;

  const needsDecision =
    row.customerClassification === "RPT" || row.customerClassification === "RECHECK";

  async function run(action: () => Promise<AdminOrderRow | void>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      onDone(updated ?? undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function searchMerge() {
    const query = mergeNumber.trim();
    if (!query) return;
    setSearching(true);
    setError(null);
    try {
      const result = await adminApi.listOrders({ search: query, pageSize: 20 });
      setMergeCandidates(result.items.filter((item) => item.id !== row!.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={
        kind === "confirm"
          ? t("orders_dialog_confirm")
          : kind === "cancel"
            ? t("orders_dialog_cancel")
            : kind === "note"
              ? t("orders_dialog_note")
              : kind === "risk"
                ? t("orders_dialog_risk")
                : kind === "merge"
                  ? t("orders_dialog_merge")
                  : t("orders_dialog_print")
      }
      width={kind === "print" ? "md" : "sm"}
    >
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
            {error}
          </p>
        ) : null}

        {kind === "confirm" ? (
          <>
            <p className="text-[13px] text-ink-secondary">
              {t("orders_dialog_confirm_hint")} {row.orderNumber}
            </p>
            {needsDecision ? (
              <Field label={t("orders_dialog_decision")} htmlFor="confirm-decision">
                <Select
                  id="confirm-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as "CONFIRM" | "CANCEL" | "REQUEST_INFO")
                  }
                >
                  <option value="CONFIRM">{t("orders_decision_confirm")}</option>
                  <option value="REQUEST_INFO">{t("orders_decision_request_info")}</option>
                  <option value="CANCEL">{t("orders_decision_cancel")}</option>
                </Select>
              </Field>
            ) : null}
          </>
        ) : null}

        {kind === "cancel" ? (
          <p className="text-[13px] text-ink-secondary">{t("orders_dialog_cancel_hint")}</p>
        ) : null}

        {kind === "note" ? (
          <Field label={t("orders_dialog_note_label")} htmlFor="row-note">
            <textarea
              id="row-note"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-ink"
            />
          </Field>
        ) : null}

        {kind === "risk" ? (
          <>
            <Field label={t("orders_dialog_risk_type")} htmlFor="row-risk-type">
              <Select
                id="row-risk-type"
                value={riskType}
                onChange={(event) => setRiskType(event.target.value)}
              >
                {RISK_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("orders_dialog_risk_reason")} htmlFor="row-risk-reason">
              <TextInput
                id="row-risk-reason"
                value={riskReason}
                onChange={(event) => setRiskReason(event.target.value)}
              />
            </Field>
          </>
        ) : null}

        {kind === "merge" ? (
          <>
            <Field label={t("orders_dialog_merge_hint")} htmlFor="row-merge">
              <div className="flex gap-2">
                <TextInput
                  id="row-merge"
                  value={mergeNumber}
                  onChange={(event) => setMergeNumber(event.target.value)}
                  placeholder={t("orders_dialog_merge_number")}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => void searchMerge()}
                  disabled={searching}
                >
                  {t("orders_dialog_merge_search")}
                </Button>
              </div>
            </Field>
            {mergeCandidates.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto rounded-lg border border-border">
                {mergeCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      onClick={() =>
                        void run(() =>
                          adminApi.mergeOrders(row.id, candidate.id, t("orders_dialog_merge_reason")),
                        )
                      }
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-ink-secondary hover:bg-background"
                    >
                      <span>{candidate.orderNumber}</span>
                      <span className="text-[11.5px] text-ink-muted">
                        {peso(candidate.grandTotal)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {kind === "print" ? (
          <>
            <div className="rounded-lg border border-border p-3 text-[13px]">
              <p className="font-semibold text-ink">{row.orderNumber}</p>
              <p className="text-ink-secondary">{row.customer.name ?? "—"}</p>
              <p className="text-ink-secondary">{row.customer.normalizedPhone}</p>
              <p className="mt-1 text-ink-secondary">
                {row.shippingAddress
                  ? [
                      row.shippingAddress.streetAddress,
                      row.shippingAddress.barangay,
                      row.shippingAddress.city,
                      row.shippingAddress.province,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "—"}
              </p>
              <ul className="mt-3 space-y-1">
                {row.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-ink">
                      {item.productNameSnapshot}
                      <span className="ml-1 font-mono text-[11.5px] text-ink-muted">
                        {item.skuCodeSnapshot}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-ink-secondary">× {item.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => window.print()}
            >
              {t("orders_dialog_print_button")}
            </Button>
          </>
        ) : null}

        {kind !== "print" ? (
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={busy}>
              {t("orders_cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={busy || (kind === "note" && !note.trim())}
              onClick={() => {
                if (kind === "confirm") {
                  if (needsDecision) {
                    void run(() =>
                      adminApi.confirmOrderWithDecision(row.id, {
                        decision,
                        note: note.trim() || undefined,
                      }),
                    );
                  } else {
                    void run(() => adminApi.confirmOrder(row.id));
                  }
                }
                if (kind === "cancel") {
                  void run(() => adminApi.cancelOrder(row.id));
                }
                if (kind === "note") {
                  void run(async () => {
                    await adminApi.addOrderNote(row.id, note.trim());
                  });
                }
                if (kind === "risk") {
                  void run(async () => {
                    await adminApi.addRiskFlag(
                      row.id,
                      riskType,
                      riskReason.trim() || undefined,
                    );
                  });
                }
              }}
            >
              {busy ? "…" : t("orders_confirm")}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
