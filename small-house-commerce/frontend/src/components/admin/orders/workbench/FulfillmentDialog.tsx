"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Textarea, TextInput } from "@/components/admin/Field";
import { InlineSelect } from "@/components/admin/InlineSelect";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminHandoverSummary,
  type AdminOrderDetail,
  type AdminOrderListRow,
} from "@/lib/admin-api";

export type FulfillmentKind = "handover" | "ship" | "sign";

export interface FulfillmentDialogProps {
  kind: FulfillmentKind;
  row: AdminOrderListRow;
  onClose: () => void;
  onDone: () => void;
}

type HandoverType = "HANDED_OVER" | "REJECTED" | "WITHDRAWN";

const HANDOVER_TYPES: HandoverType[] = ["HANDED_OVER", "REJECTED", "WITHDRAWN"];

function HandoverEventSelect({
  value,
  onChange,
}: {
  value: HandoverType;
  onChange: (value: HandoverType) => void;
}) {
  const { t } = useAdminI18n();
  const labelFor = (type: HandoverType) =>
    t(
      type === "HANDED_OVER"
        ? "orders_handover_handed"
        : type === "REJECTED"
          ? "orders_handover_rejected"
          : "orders_handover_withdrawn",
    );

  return (
    <InlineSelect
      id="handover-event"
      ariaLabel={t("orders_handover_type")}
      value={value}
      options={HANDOVER_TYPES.map((type) => ({ value: type, label: labelFor(type) }))}
      onChange={onChange}
    />
  );
}


export function FulfillmentDialog({
  kind,
  row,
  onClose,
  onDone,
}: FulfillmentDialogProps) {
  const { t } = useAdminI18n();
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [handover, setHandover] = useState<AdminHandoverSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventType, setEventType] = useState<HandoverType>("HANDED_OVER");
  const [quantityEdits, setQuantityEdits] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  useEffect(() => {
    let active = true;
    const detailRequest =
      kind === "ship" || kind === "sign"
        ? adminApi.getOrder(row.id)
        : Promise.resolve(null);
    const handoverRequest =
      kind === "handover" ? adminApi.handoverSummary(row.id) : Promise.resolve(null);
    Promise.all([detailRequest, handoverRequest])
      .then(([nextDetail, nextHandover]) => {
        if (!active) return;
        setDetail(nextDetail);
        setHandover(nextHandover);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Request failed.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, row.id]);

  const handoverLines = useMemo(() => {
    const source =
      eventType === "HANDED_OVER" && handover
        ? handover.outstanding
        : row.items.map((item) => ({
            orderItemId: item.id,
            quantity: item.quantity,
            skuCodeSnapshot: item.skuCodeSnapshot,
          }));
    return source.map((entry) => ({
      ...entry,
      productName:
        row.items.find((item) => item.id === entry.orderItemId)?.productNameSnapshot ?? "—",
      max: entry.quantity,
    }));
  }, [eventType, handover, row.items]);

  const remainingLines = useMemo(() => {
    const shipped = new Map<string, number>();
    for (const shipment of detail?.shipments ?? []) {
      for (const item of shipment.items) {
        shipped.set(item.orderItemId, (shipped.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }
    return row.items.map((item) => ({
      item,
      remaining: Math.max(0, item.quantity - (shipped.get(item.id) ?? 0)),
    }));
  }, [detail, row.items]);

  const quantityFor = (orderItemId: string, fallback: number) =>
    quantityEdits[orderItemId] ?? fallback;

  const reasonRequired = eventType !== "HANDED_OVER";
  const handoverItems = handoverLines
    .map((entry) => ({
      orderItemId: entry.orderItemId,
      quantity: Math.min(
        Math.max(quantityFor(entry.orderItemId, entry.quantity), 0),
        entry.max,
      ),
    }))
    .filter((entry) => entry.quantity > 0);

  const shipItems = remainingLines
    .map((entry) => ({
      orderItemId: entry.item.id,
      quantity: Math.min(
        Math.max(quantityFor(entry.item.id, entry.remaining), 0),
        entry.remaining,
      ),
    }))
    .filter((entry) => entry.quantity > 0);

  const canSubmit =
    !busy &&
    !loading &&
    (kind === "handover"
      ? handoverItems.length > 0 && (!reasonRequired || reason.trim().length > 0)
      : kind === "ship"
        ? shipItems.length > 0 && carrier.trim().length > 0
        : false);

  async function submitHandover() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.recordHandover(row.id, {
        type: eventType,
        reason: reasonRequired ? reason.trim() : null,
        note: note.trim() || null,
        items: handoverItems,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitShipment() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.shipOrder(row.id, {
        carrier: carrier.trim(),
        trackingNumber: trackingNumber.trim() || undefined,
        items: shipItems,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sign(shipmentId: string) {
    setBusy(true);
    setError(null);
    try {
      await adminApi.signShipment(row.id, shipmentId);
      onDone();
      // The server decides whether the box is signed or partly returned, and
      // whether the order is finished. Refetch instead of guessing locally.
      const fresh = await adminApi.getOrder(row.id);
      setDetail(fresh);
      if (!(fresh.shipments ?? []).some((shipment) => shipment.status === "SHIPPING")) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    kind === "handover"
      ? t("orders_handover_title")
      : kind === "ship"
        ? t("orders_ship_title")
        : t("orders_sign_title");

  const waitingShipments = (detail?.shipments ?? []).filter(
    (shipment) => shipment.status === "SHIPPING",
  );
  const returnedByShipment = useMemo(() => {
    const map = new Map<string, number>();
    for (const acceptance of detail?.returnAcceptances ?? []) {
      for (const item of acceptance.items) {
        map.set(
          acceptance.shipmentId,
          (map.get(acceptance.shipmentId) ?? 0) + item.quantityGood + item.quantityDamaged,
        );
      }
    }
    return map;
  }, [detail]);

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={title}
      width={kind === "sign" ? "sm" : "md"}
    >
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
            {error}
          </p>
        ) : null}
        {loading ? <p className="text-[13px] text-ink-muted">…</p> : null}

        {kind === "handover" && !loading ? (
          <>
            <Field label={t("orders_handover_type")} htmlFor="handover-event">
              <HandoverEventSelect
                value={eventType}
                onChange={(value) => {
                  // Re-picking the current event must keep the edited
                  // quantities; only a real switch changes the line set.
                  if (value === eventType) return;
                  setEventType(value);
                  setQuantityEdits({});
                }}
              />
            </Field>

            {eventType === "WITHDRAWN" ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                {t("orders_handover_withdraw_warning")}
              </p>
            ) : null}
            {eventType === "REJECTED" ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                {t("orders_handover_reject_warning")}
              </p>
            ) : null}
            {eventType === "HANDED_OVER" && handover?.complete ? (
              <p className="rounded-lg bg-admin-success-soft px-3 py-2 text-[12.5px] text-admin-success">
                {t("orders_handover_complete")}
              </p>
            ) : null}

            {handoverLines.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t("orders_ship_none")}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border bg-background text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2">{t("orders_col_product")}</th>
                      <th className="px-3 py-2 text-right">{t("orders_handover_outstanding")}</th>
                      <th className="px-3 py-2 text-right">{t("orders_handover_qty")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {handoverLines.map((entry) => (
                      <tr key={entry.orderItemId} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2">
                          <div className="text-ink">{entry.productName}</div>
                          <div className="font-mono text-[11px] text-ink-muted">
                            {entry.skuCodeSnapshot}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                          {entry.quantity}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <TextInput
                            type="number"
                            min={0}
                            max={entry.max}
                            aria-label={`${t("orders_handover_qty")} ${entry.skuCodeSnapshot}`}
                            value={quantityFor(entry.orderItemId, entry.quantity)}
                            onChange={(event) =>
                              setQuantityEdits((current) => ({
                                ...current,
                                [entry.orderItemId]: Number(event.target.value),
                              }))
                            }
                            className="w-20 text-right"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Field label={t("orders_handover_reason")} htmlFor="handover-reason">
              <TextInput
                id="handover-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <Field label={t("orders_handover_note")} htmlFor="handover-note">
              <Textarea
                id="handover-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
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
                disabled={!canSubmit}
                onClick={() => void submitHandover()}
              >
                {t("orders_handover_submit")}
              </Button>
            </div>
          </>
        ) : null}

        {kind === "ship" && !loading ? (
          <>
            <p className="text-[13px] text-ink-secondary">{t("orders_ship_hint")}</p>
            {remainingLines.every((entry) => entry.remaining === 0) ? (
              <p className="text-[13px] text-ink-muted">{t("orders_ship_none")}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border bg-background text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2">{t("orders_col_product")}</th>
                      <th className="px-3 py-2 text-right">{t("orders_ship_remaining")}</th>
                      <th className="px-3 py-2 text-right">{t("orders_col_qty")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remainingLines
                      .filter((entry) => entry.remaining > 0)
                      .map((entry) => (
                        <tr key={entry.item.id} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-2">
                            <div className="text-ink">{entry.item.productNameSnapshot}</div>
                            <div className="font-mono text-[11px] text-ink-muted">
                              {entry.item.skuCodeSnapshot}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                            {entry.remaining}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <TextInput
                              type="number"
                              min={0}
                              max={entry.remaining}
                              aria-label={`${t("orders_col_qty")} ${entry.item.skuCodeSnapshot}`}
                              value={quantityFor(entry.item.id, entry.remaining)}
                              onChange={(event) =>
                                setQuantityEdits((current) => ({
                                  ...current,
                                  [entry.item.id]: Number(event.target.value),
                                }))
                              }
                              className="w-20 text-right"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {kind === "ship" ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCarrier("J&T Express")}
                  className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-cta hover:bg-primary-light/40"
                >
                  {t("orders_ship_carrier_jt")}
                </button>
              </div>
            ) : null}
            <Field label={t("orders_ship_carrier")} htmlFor="ship-carrier">
              <TextInput
                id="ship-carrier"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
              />
            </Field>
            <Field label={t("orders_ship_tracking")} htmlFor="ship-tracking">
              <TextInput
                id="ship-tracking"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
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
                disabled={!canSubmit}
                onClick={() => void submitShipment()}
              >
                {t("orders_ship_submit")}
              </Button>
            </div>
          </>
        ) : null}

        {kind === "sign" && !loading ? (
          <>
            {waitingShipments.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t("orders_sign_none")}</p>
            ) : (
              <ul className="space-y-2">
                {waitingShipments.map((shipment) => {
                  const shipped = shipment.items.reduce((sum, item) => sum + item.quantity, 0);
                  const returned = Math.min(returnedByShipment.get(shipment.id) ?? 0, shipped);
                  const left = Math.max(shipped - returned, 0);
                  return (
                    <li
                      key={shipment.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[13px]"
                    >
                      <div className="min-w-0">
                        <div className="text-ink">
                          {shipment.carrier}
                          {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}
                        </div>
                        <div className="text-[11.5px] text-ink-muted">
                          {returned > 0
                            ? t("orders_sign_partial_note", { returned, left })
                            : `${shipped} ${t("orders_shipment_items")}`}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        disabled={busy}
                        onClick={() => void sign(shipment.id)}
                      >
                        {returned > 0
                          ? t("orders_sign_remaining_submit")
                          : t("orders_sign_submit")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end pt-1">
              <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={busy}>
                {t("orders_close")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
