"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Button } from "@/components/ui/Button";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminCheckoutDraftDetail,
  type AdminDraftRisk,
} from "@/lib/admin-api";

type Customer = AdminCheckoutDraftDetail["snapshot"]["customer"];
const FIELDS: { key: keyof Customer; label: TKey; required?: boolean }[] = [
  { key: "name", label: "checkout_drafts_field_name", required: true },
  { key: "phone", label: "checkout_drafts_field_phone", required: true },
  { key: "province", label: "orders_create_province", required: true },
  { key: "city", label: "orders_create_city", required: true },
  { key: "barangay", label: "orders_create_barangay" },
  { key: "postalCode", label: "orders_draft_postal_code" },
  { key: "streetAddress", label: "orders_create_street", required: true },
  { key: "landmark", label: "orders_draft_landmark" },
];

export function DraftConversionPanel({
  draft,
  canConvert,
  onConverted,
}: {
  draft: AdminCheckoutDraftDetail;
  canConvert: boolean;
  onConverted: (orderId: string) => void;
}) {
  const { t } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer>(() => ({
    name: "",
    phone: "",
    province: "",
    city: "",
    barangay: "",
    postalCode: "",
    streetAddress: "",
    landmark: "",
    ...(draft.snapshot?.customer as Partial<Customer> | undefined),
  }));
  const [date, setDate] = useState(draft.snapshot?.preferredDeliveryDate ?? "");
  const [note, setNote] = useState(draft.snapshot?.customerNote ?? "");
  const [reviewed, setReviewed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [riskState, setRiskState] = useState<{
    key: string;
    risk: AdminDraftRisk | null;
  } | null>(null);
  const riskKey = JSON.stringify([customer.phone, retry]);
  const risk = riskState?.key === riskKey ? riskState.risk : null;
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      adminApi
        .checkoutDraftRisk(draft.id, customer.phone)
        .then((value) => {
          if (alive) setRiskState({ key: riskKey, risk: value });
        })
        .catch(() => {
          if (alive) setRiskState({ key: riskKey, risk: null });
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [customer.phone, draft.id, riskKey]);

  async function convert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting.current ||
      !risk?.validPhone ||
      (risk.requiresReview && !reviewed)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const order = await adminApi.convertCheckoutDraft(draft.id, {
        expectedRevision: draft.clientRevision,
        customer,
        preferredDeliveryDate: date || null,
        customerNote: note,
        riskReviewed: reviewed,
      });
      onConverted(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("orders_load_error"));
      setReviewed(false);
      setRetry((n) => n + 1);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const riskBlock = (
    <div className="space-y-2 text-sm">
      {riskState?.key !== riskKey ? (
        <p className="text-ink-muted">{t("orders_draft_risk_loading")}</p>
      ) : !risk ? (
        <p role="alert" className="text-sale">
          {t("orders_draft_risk_error")}
        </p>
      ) : !risk.validPhone ? (
        <p className="text-ink-secondary">
          {t("orders_draft_risk_invalid_phone")}
        </p>
      ) : (
        <>
          <p
            className={
              risk.requiresReview
                ? "font-semibold text-sale"
                : "text-ink-secondary"
            }
          >
            {risk.requiresReview ? t("orders_draft_risk") : risk.classification}
          </p>
          {risk.reason ? (
            <p className="text-ink-secondary">{risk.reason}</p>
          ) : null}
          {risk.orders.length > 0 ? (
            <ul className="flex flex-wrap gap-3">
              {risk.orders.map((order) => (
                <li key={order.id}>
                  <Link
                    className="text-cta hover:underline"
                    href={`/admin/orders/${order.id}`}
                  >
                    {order.orderNumber}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <button
        type="button"
        disabled={busy}
        className="text-xs text-cta hover:underline"
        onClick={() => {
          setReviewed(false);
          setRetry((n) => n + 1);
        }}
      >
        {t("orders_draft_retry_risk")}
      </button>
    </div>
  );
  const noItems = !draft.snapshot?.items?.length;
  return (
    <section className="mt-4 space-y-3 rounded-xl border border-border bg-card p-4">
      {riskBlock}
      {noItems ? (
        <p className="text-sm text-ink-muted">{t("orders_draft_no_items")}</p>
      ) : null}
      {canConvert ? (
        <Button
          size="sm"
          variant="primary"
          disabled={noItems}
          onClick={() => setOpen(true)}
        >
          {t("orders_draft_convert")}
        </Button>
      ) : null}
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("orders_draft_convert")}
        width="md"
      >
        <form onSubmit={(event) => void convert(event)} className="space-y-4">
          <p className="text-sm text-ink-secondary">
            {t("orders_draft_convert_hint")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <label
                key={field.key}
                className="block text-xs text-ink-secondary"
              >
                {t(field.label)}
                {field.required ? " *" : ""}
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm"
                  name={field.key}
                  value={customer[field.key]}
                  required={field.required}
                  maxLength={
                    field.key === "phone"
                      ? 24
                      : field.key === "postalCode"
                        ? 20
                        : field.key === "streetAddress" ||
                            field.key === "landmark"
                          ? 255
                          : 120
                  }
                  disabled={busy}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCustomer((c) => ({ ...c, [field.key]: value }));
                    if (field.key === "phone") setReviewed(false);
                  }}
                />
              </label>
            ))}
          </div>
          <label className="block text-xs text-ink-secondary">
            {t("checkout_drafts_field_date")}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm"
            />
          </label>
          <p className="text-xs text-ink-muted">
            {t("orders_draft_date_hint")}
          </p>
          <label className="block text-xs text-ink-secondary">
            {t("checkout_drafts_field_note")}
            <textarea
              value={note}
              maxLength={200}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm"
            />
          </label>
          {riskBlock}
          {risk?.requiresReview ? (
            <label className="flex items-start gap-2 text-sm text-sale">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {t("orders_draft_reviewed")}
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-sale">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("orders_cancel")}
            </Button>
            <Button
              type="submit"
              size="md"
              disabled={
                busy || !risk?.validPhone || (risk.requiresReview && !reviewed)
              }
            >
              {busy ? "…" : t("orders_draft_convert")}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
