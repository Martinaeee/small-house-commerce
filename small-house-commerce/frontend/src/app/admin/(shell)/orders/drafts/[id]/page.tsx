"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminCheckoutDraftDetail } from "@/lib/admin-api";

export default function CheckoutDraftDetailPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const [draft, setDraft] = useState<AdminCheckoutDraftDetail | null>(null);
  const [error, setError] = useState(false);
  const canView = hasPermission("ORDER_VIEW_ALL");

  useEffect(() => {
    if (!canView) return;
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
