"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { Field, TextInput } from "@/components/admin/Field";
import { InlineSelect } from "@/components/admin/InlineSelect";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminLogisticsEventStatus,
  type AdminShipment,
} from "@/lib/admin-api";
import { LOGISTICS_STATUSES, LOGISTICS_STATUS_KEYS } from "./logistics-labels";

function inputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Records one carrier event as reported. The event is an append-only fact:
 * the dialog never promises or performs a status change on the order.
 */
export function LogisticsEventDialog({
  orderId,
  shipment,
  onClose,
  onDone,
}: {
  orderId: string;
  shipment: AdminShipment;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useAdminI18n();
  const [status, setStatus] = useState<AdminLogisticsEventStatus>("IN_TRANSIT");
  const [eventTime, setEventTime] = useState(() => inputValue(new Date()));
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [externalStatus, setExternalStatus] = useState("");
  const [externalEventId, setExternalEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.recordLogisticsEvent(orderId, shipment.id, {
        normalizedStatus: status,
        eventTime: new Date(eventTime).toISOString(),
        city: city.trim() || undefined,
        province: province.trim() || undefined,
        externalStatus: externalStatus.trim() || undefined,
        externalEventId: externalEventId.trim() || undefined,
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
    <Dialog open onClose={busy ? () => {} : onClose} title={t("orders_logistics_title")}>
      <div className="space-y-4">
        <p className="text-[13px] text-ink-secondary">{t("orders_logistics_hint")}</p>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-[13px] text-red-800">
            {error}
          </p>
        ) : null}

        <Field label={t("orders_logistics_status")} htmlFor="logistics-status">
          <InlineSelect
            id="logistics-status"
            ariaLabel={t("orders_logistics_status")}
            value={status}
            options={LOGISTICS_STATUSES.map((value) => ({
              value,
              label: t(LOGISTICS_STATUS_KEYS[value]),
            }))}
            onChange={setStatus}
          />
        </Field>

        <Field label={t("orders_logistics_time")} htmlFor="logistics-time">
          <TextInput
            id="logistics-time"
            type="datetime-local"
            value={eventTime}
            onChange={(event) => setEventTime(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("orders_logistics_city")} htmlFor="logistics-city">
            <TextInput
              id="logistics-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </Field>
          <Field label={t("orders_logistics_province")} htmlFor="logistics-province">
            <TextInput
              id="logistics-province"
              value={province}
              onChange={(event) => setProvince(event.target.value)}
            />
          </Field>
        </div>

        <Field label={t("orders_logistics_note")} htmlFor="logistics-note">
          <TextInput
            id="logistics-note"
            value={externalStatus}
            onChange={(event) => setExternalStatus(event.target.value)}
          />
        </Field>

        <Field label={t("orders_logistics_external_id")} htmlFor="logistics-external-id">
          <TextInput
            id="logistics-external-id"
            value={externalEventId}
            onChange={(event) => setExternalEventId(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={busy}>
            {t("orders_cancel")}
          </Button>
          <Button type="button" variant="primary" size="md" disabled={busy} onClick={() => void submit()}>
            {t("orders_logistics_submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
