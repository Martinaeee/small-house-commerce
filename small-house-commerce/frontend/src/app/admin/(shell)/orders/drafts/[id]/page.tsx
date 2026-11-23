"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DraftConversionPanel } from "@/components/admin/orders/workbench/DraftConversionPanel";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { FOLLOW_UP_NOTE_TEMPLATES, followUpNoteFromTemplate } from "@/lib/checkout-draft-follow-up";
import {
  adminApi,
  type AdminCheckoutDraftDetail,
  type CheckoutDraftFollowUpStatus,
} from "@/lib/admin-api";

const FOLLOW_UP_STATUSES: CheckoutDraftFollowUpStatus[] = [
  "TO_CONTACT",
  "NO_ANSWER",
  "FOLLOW_UP_LATER",
  "WANTS_TO_BUY",
  "DECLINED",
];

export default function CheckoutDraftDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const [draft, setDraft] = useState<AdminCheckoutDraftDetail | null>(null);
  const [error, setError] = useState(false);
  const canView = hasPermission("ORDER_VIEW_ALL");
  const canFollowUp = hasPermission("ORDER_VERIFY");

  const load = useCallback(() => {
    if (!canView) return () => {};
    let alive = true;
    adminApi.getCheckoutDraft(params.id).then((value) => {
      if (alive) {
        setDraft(value);
        setError(false);
      }
    }).catch(() => {
      if (alive) setError(true);
    });
    return () => {
      alive = false;
    };
  }, [canView, params.id]);

  useEffect(() => load(), [load]);

  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [followStatus, setFollowStatus] = useState<CheckoutDraftFollowUpStatus>("TO_CONTACT");
  const [assigneeId, setAssigneeId] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [note, setNote] = useState("");
  const [noteTemplate, setNoteTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canFollowUp) return;
    adminApi.listAssignees().then(setAssignees).catch(() => setAssignees([]));
  }, [canFollowUp]);

  // Seed the form from the saved conclusion so a second operator sees the
  // owner and note that are already in place.
  const seededId = draft?.id ?? null;
  useEffect(() => {
    if (!draft) return;
    setFollowStatus(draft.followUpStatus ?? "TO_CONTACT");
    setAssigneeId(draft.assignee?.id ?? "");
    setNextAt(toLocalInput(draft.nextFollowUpAt));
    setNote(draft.followUpNote ?? "");
    setNoteTemplate("");
  }, [seededId, draft]);

  async function saveFollowUp() {
    setSaving(true);
    setSaveMessage(null);
    try {
      await adminApi.followUpCheckoutDraft(params.id, {
        status: followStatus,
        assigneeId: assigneeId || null,
        nextFollowUpAt: nextAt ? new Date(nextAt).toISOString() : null,
        note: note.trim() || null,
      });
      setSaveMessage(t("checkout_drafts_followup_saved"));
      load();
    } catch {
      setSaveMessage(t("checkout_drafts_followup_error"));
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <p className="px-4 py-6 text-sm text-ink-secondary md:px-8">
        {t("checkout_drafts_no_permission")}
      </p>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-6 md:px-8">
        <p role="alert" className="text-sm text-sale">{t("checkout_drafts_load_error")}</p>
        <Link href="/admin/orders/drafts" className="mt-3 inline-block text-sm text-cta hover:underline">
          {t("checkout_drafts_detail_back")}
        </Link>
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="px-4 py-6 md:px-8">
        <TableSkeleton />
      </div>
    );
  }

  // A converted draft created from the order alone carries an empty snapshot:
  // fall back to the contact the order wrote onto the row.
  const snapshot = draft.snapshot as Partial<AdminCheckoutDraftDetail["snapshot"]> | undefined;
  const customer = {
    name: "",
    phone: "",
    province: "",
    city: "",
    barangay: "",
    postalCode: "",
    streetAddress: "",
    landmark: "",
    ...(snapshot?.customer ?? {}),
  };
  const address = [
    customer.streetAddress,
    customer.barangay,
    customer.city,
    customer.province,
    customer.postalCode,
    customer.landmark,
  ]
    .filter(Boolean)
    .join(", ");
  const followUpEvents = draft.followUpEvents ?? [];
  return (
    <div className="w-full max-w-none px-4 py-5 md:px-8">
      <PageHeader
        title={t("checkout_drafts_detail_title")}
        subtitle={draft.contactPhone || t("checkout_drafts_not_filled_yet")}
        actions={
          <Link
            href="/admin/orders/drafts"
            className="text-sm font-medium text-cta hover:underline"
          >
            {t("checkout_drafts_detail_back")}
          </Link>
        }
      />
      {draft.status === "OPEN" ? <DraftConversionPanel
        key={`${draft.id}:${draft.clientRevision}`} draft={draft} canConvert={hasPermission("ORDER_CONFIRM")}
        onConverted={id => router.push(`/admin/orders/${id}`)}
      /> : null}
      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">
          {t("checkout_drafts_detail_fields")}
        </h2>
        <dl
          data-testid="draft-fields"
          className="mt-3 grid gap-2 text-sm sm:grid-cols-2"
        >
          <Row
            label={t("checkout_drafts_field_name")}
            value={customer.name || (draft.contactName ?? "")}
          />
          <Row
            label={t("checkout_drafts_field_phone")}
            value={customer.phone || (draft.contactPhone ?? "")}
          />
          <Row label={t("checkout_drafts_field_address")} value={address} />
          <Row
            label={t("checkout_drafts_field_date")}
            value={draft.snapshot?.preferredDeliveryDate ?? ""}
          />
          <Row
            label={t("checkout_drafts_field_promo")}
            value={
              draft.snapshot?.promoCodeApplied ??
              draft.snapshot?.promoCodeInput ??
              ""
            }
          />
          <Row
            label={t("checkout_drafts_field_note")}
            value={draft.snapshot?.customerNote ?? ""}
          />
        </dl>
      </section>
      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">
          {t("checkout_drafts_detail_products")}
        </h2>
        <ul className="mt-3 divide-y divide-border/60 text-sm">
          {draft.productSnapshot?.length === 0 ? (
            <li className="py-2 text-ink-muted">
              {t("checkout_drafts_not_filled_yet")}
            </li>
          ) : null}
          {draft.productSnapshot?.map((line) => (
            <li key={line.skuId} className="flex items-center gap-3 py-2">
              {line.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={line.thumbnailUrl}
                  alt=""
                  className="h-10 w-10 rounded object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {line.productName ?? t("checkout_drafts_unavailable_item")}
                </p>
                <p className="text-xs text-ink-muted">
                  {[line.variantName, line.skuCode].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="text-ink-secondary">×{line.quantity}</span>
              <span>
                {line.unitPrice
                  ? `₱${Number(line.unitPrice).toLocaleString()}`
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-4 rounded-xl border border-border bg-card p-4 text-sm" data-testid="draft-followup">
        <h2 className="text-sm font-semibold">{t("checkout_drafts_followup_title")}</h2>
        {draft.status === "CONVERTED" ? null : canFollowUp ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs text-ink-muted">{t("checkout_drafts_followup_status")}</span>
              <select
                aria-label={t("checkout_drafts_followup_status")}
                value={followStatus}
                onChange={(event) => setFollowStatus(event.target.value as CheckoutDraftFollowUpStatus)}
                className="h-9 rounded-lg border border-border bg-card px-2"
              >
                {FOLLOW_UP_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`checkout_drafts_followup_status_${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-ink-muted">{t("checkout_drafts_followup_assignee")}</span>
              <select
                aria-label={t("checkout_drafts_followup_assignee")}
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className="h-9 rounded-lg border border-border bg-card px-2"
              >
                <option value="">{t("checkout_drafts_followup_unassigned")}</option>
                {assignees.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-ink-muted">{t("checkout_drafts_followup_next")}</span>
              <input
                type="datetime-local"
                aria-label={t("checkout_drafts_followup_next")}
                value={nextAt}
                onChange={(event) => setNextAt(event.target.value)}
                className="h-9 rounded-lg border border-border bg-card px-2"
              />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs text-ink-muted">{t("checkout_drafts_followup_template")}</span>
              <select
                aria-label={t("checkout_drafts_followup_template")}
                value={noteTemplate}
                onChange={(event) => {
                  setNoteTemplate(event.target.value);
                  const text = followUpNoteFromTemplate(
                    event.target.value,
                    draft.productSnapshot?.[0]?.productName,
                    t,
                  );
                  if (text) setNote(text);
                }}
                className="h-9 rounded-lg border border-border bg-card px-2"
              >
                <option value="">{t("checkout_drafts_followup_template_placeholder")}</option>
                {FOLLOW_UP_NOTE_TEMPLATES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {followUpNoteFromTemplate(item.id, draft.productSnapshot?.[0]?.productName, t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs text-ink-muted">{t("checkout_drafts_followup_note")}</span>
              <textarea
                aria-label={t("checkout_drafts_followup_note")}
                value={note}
                maxLength={500}
                rows={2}
                onChange={(event) => {
                  setNoteTemplate("");
                  setNote(event.target.value);
                }}
                className="rounded-lg border border-border bg-card px-2 py-1"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button
                type="button"
                onClick={() => void saveFollowUp()}
                disabled={saving}
                className="rounded-lg bg-cta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {t("checkout_drafts_followup_save")}
              </button>
              {saveMessage ? <span role="status" className="text-xs text-ink-secondary">{saveMessage}</span> : null}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-muted">{t("checkout_drafts_followup_no_permission")}</p>
        )}
        {followUpEvents.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs text-ink-muted">{t("checkout_drafts_followup_timeline")}</h3>
            <ul className="mt-2 space-y-1 text-xs text-ink-secondary">
              {followUpEvents.map((event) => (
                <li key={event.id}>
                  {new Date(event.createdAt).toLocaleString()} · {t(`checkout_drafts_followup_status_${event.toStatus}`)}
                  {event.operatorName ? ` · ${event.operatorName}` : ""}
                  {event.note ? ` · ${event.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section className="mt-4 rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="text-sm font-semibold">
          {t("checkout_drafts_detail_timeline")}
        </h2>
        <p className="mt-2 text-ink-secondary">
          {t("checkout_drafts_detail_created")}:{" "}
          {new Date(draft.createdAt).toLocaleString()}
        </p>
        <p className="text-ink-secondary">
          {t("checkout_drafts_detail_updated")}:{" "}
          {new Date(draft.updatedAt).toLocaleString()}
        </p>
        <p className="text-ink-secondary">
          {t("checkout_drafts_detail_expires")}:{" "}
          {new Date(draft.expiresAt).toLocaleDateString()}
        </p>
        {draft.convertedAt ? <p className="text-ink-secondary">{t("orders_draft_converted")}: {new Date(draft.convertedAt).toLocaleString()}</p> : null}
        {draft.orderId ? (
          <Link
            href={`/admin/orders/${draft.orderId}`}
            className="mt-2 inline-block font-medium text-cta hover:underline"
          >
            {t("checkout_drafts_detail_order")} {draft.orderNumber}
          </Link>
        ) : null}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="break-words">{value.trim() === "" ? "—" : value}</dd>
    </div>
  );
}

/** datetime-local needs a local wall-clock string, not the ISO instant. */
function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
