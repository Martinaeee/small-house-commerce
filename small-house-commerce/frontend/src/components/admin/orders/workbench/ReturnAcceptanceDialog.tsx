"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, TextInput } from "@/components/admin/Field";
import { InlineSelect } from "@/components/admin/InlineSelect";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminOrderDetail, type AdminOrderItem, type AdminShipment } from "@/lib/admin-api";

interface Edits {
  good: number;
  damaged: number;
  note: string;
}

function boxLabel(shipment: AdminShipment): string {
  return `${shipment.carrier}${
    shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ` · ${shipment.id.slice(0, 8)}`
  }`;
}

/**
 * RTO acceptance. One batch belongs to one shipment: the warehouse counts what
 * came back in that box, the server caps the totals by what that box shipped
 * and restocks only the good units.
 */
export function ReturnAcceptanceDialog({
  orderId,
  detail,
  onClose,
  onDone,
}: {
  orderId: string;
  detail: AdminOrderDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useAdminI18n();
  const [selection, setSelection] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Edits>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a box still shipping can receive an RTO; signed and returned boxes
  // are closed. Acceptances are counted per box, so two boxes of the same
  // line never share a cap.
  const eligible = useMemo(() => {
    const acceptedByBox = new Map<string, Map<string, number>>();
    for (const acceptance of detail.returnAcceptances ?? []) {
      const perLine = acceptedByBox.get(acceptance.shipmentId) ?? new Map<string, number>();
      for (const item of acceptance.items) {
        perLine.set(
          item.orderItemId,
          (perLine.get(item.orderItemId) ?? 0) + item.quantityGood + item.quantityDamaged,
        );
      }
      acceptedByBox.set(acceptance.shipmentId, perLine);
    }
    return (detail.shipments ?? [])
      .filter((shipment) => shipment.status === "SHIPPING")
      .map((shipment) => {
        const shipped = new Map<string, number>();
        for (const item of shipment.items) {
          shipped.set(item.orderItemId, (shipped.get(item.orderItemId) ?? 0) + item.quantity);
        }
        const accepted = acceptedByBox.get(shipment.id) ?? new Map<string, number>();
        const lines = [...shipped.entries()]
          .map(([orderItemId, quantity]) => ({
            item: (detail.items ?? []).find((entry) => entry.id === orderItemId),
            remaining: Math.max(0, quantity - (accepted.get(orderItemId) ?? 0)),
          }))
          .filter(
            (entry): entry is { item: AdminOrderItem; remaining: number } =>
              Boolean(entry.item) && entry.remaining > 0,
          );
        return { shipment, lines };
      })
      .filter((entry) => entry.lines.length > 0);
  }, [detail]);

  const active =
    eligible.find((entry) => entry.shipment.id === selection) ?? eligible[0] ?? null;

  const editFor = (shipmentId: string, orderItemId: string, remaining: number): Edits =>
    edits[`${shipmentId}:${orderItemId}`] ?? { good: remaining, damaged: 0, note: "" };

  function update(
    shipmentId: string,
    orderItemId: string,
    remaining: number,
    patch: Partial<Edits>,
  ) {
    const key = `${shipmentId}:${orderItemId}`;
    setEdits((current) => {
      const base = current[key] ?? { good: remaining, damaged: 0, note: "" };
      const next = { ...base, ...patch };
      next.good = Math.min(Math.max(next.good, 0), remaining);
      next.damaged = Math.min(Math.max(next.damaged, 0), remaining - next.good);
      return { ...current, [key]: next };
    });
  }

  const items = active
    ? active.lines
        .map((entry) => {
          const edit = editFor(active.shipment.id, entry.item.id, entry.remaining);
          return {
            orderItemId: entry.item.id,
            quantityGood: edit.good,
            quantityDamaged: edit.damaged,
            conditionNote: edit.note.trim() || undefined,
          };
        })
        .filter((entry) => entry.quantityGood + entry.quantityDamaged > 0)
    : [];

  async function submit() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.acceptReturn(orderId, {
        shipmentId: active.shipment.id,
        reason: reason.trim() || undefined,
        items,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? () => {} : onClose} title={t("orders_returns_title")}>
      <div className="space-y-4">
        <p className="text-[13px] text-ink-secondary">{t("orders_returns_hint")}</p>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
            {error}
          </p>
        ) : null}

        {active ? (
          <>
            <Field label={t("orders_returns_shipment")} htmlFor="return-shipment">
              <InlineSelect
                id="return-shipment"
                ariaLabel={t("orders_returns_shipment")}
                value={active.shipment.id}
                options={eligible.map((entry) => ({
                  value: entry.shipment.id,
                  label: boxLabel(entry.shipment),
                }))}
                onChange={setSelection}
              />
            </Field>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-background text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2">{t("orders_col_product")}</th>
                    <th className="px-3 py-2 text-right">{t("orders_returns_remaining")}</th>
                    <th className="px-3 py-2 text-right">{t("orders_returns_good")}</th>
                    <th className="px-3 py-2 text-right">{t("orders_returns_damaged")}</th>
                  </tr>
                </thead>
                <tbody>
                  {active.lines.map((entry) => {
                    const edit = editFor(active.shipment.id, entry.item.id, entry.remaining);
                    return (
                      <tr key={entry.item.id} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2">
                          <div className="text-ink">{entry.item.productNameSnapshot}</div>
                          <div className="font-mono text-[11px] text-ink-muted">
                            {entry.item.skuCodeSnapshot}
                          </div>
                          {edit.damaged > 0 ? (
                            <TextInput
                              aria-label={`${t("orders_returns_condition")} ${entry.item.skuCodeSnapshot}`}
                              value={edit.note}
                              placeholder={t("orders_returns_condition")}
                              onChange={(event) =>
                                update(active.shipment.id, entry.item.id, entry.remaining, {
                                  note: event.target.value,
                                })
                              }
                              className="mt-1"
                            />
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                          {entry.remaining}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <TextInput
                            type="number"
                            min={0}
                            max={entry.remaining}
                            aria-label={`${t("orders_returns_good")} ${entry.item.skuCodeSnapshot}`}
                            value={edit.good}
                            onChange={(event) =>
                              update(active.shipment.id, entry.item.id, entry.remaining, {
                                good: Number(event.target.value),
                              })
                            }
                            className="w-20 text-right"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <TextInput
                            type="number"
                            min={0}
                            max={entry.remaining}
                            aria-label={`${t("orders_returns_damaged")} ${entry.item.skuCodeSnapshot}`}
                            value={edit.damaged}
                            onChange={(event) =>
                              update(active.shipment.id, entry.item.id, entry.remaining, {
                                damaged: Number(event.target.value),
                              })
                            }
                            className="w-20 text-right"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-ink-muted">{t("orders_returns_no_shipment")}</p>
        )}

        <Field label={t("orders_returns_reason")} htmlFor="return-reason">
          <TextInput
            id="return-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={busy}>
            {t("orders_cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy || items.length === 0}
            onClick={() => void submit()}
          >
            {t("orders_returns_submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
