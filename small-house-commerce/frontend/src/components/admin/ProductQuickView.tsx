"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/admin/Badge";
import { adminApi, formatAmount, type AdminProduct } from "@/lib/admin-api";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";

/**
 * Read-only product peek from the list.
 *
 * It never owns a second editing state: the row is what the list already
 * fetched, and the FULL graph is loaded only for the one product the operator
 * opened — never for every row (that would be an N+1 against the list).
 */

const STATUS_LABEL_KEYS: Record<AdminProduct["status"], TKey> = {
  DRAFT: "product_form_status_draft",
  ACTIVE: "product_form_status_active",
  DISABLED: "product_form_status_disabled",
};

const STOREFRONT_LABEL_KEYS: Record<AdminProduct["status"], TKey> = {
  ACTIVE: "products_storefront_live",
  DRAFT: "products_storefront_draft",
  DISABLED: "products_storefront_unpublished",
};

const STATUS_TONES: Record<AdminProduct["status"], "green" | "amber" | "red"> = {
  ACTIVE: "green",
  DRAFT: "amber",
  DISABLED: "red",
};

function priceRange(row: AdminProduct): string {
  const prices = new Set<number>();
  for (const variant of row.variants) {
    const sku = variant.sku;
    if (!sku || sku.status !== "ACTIVE" || sku.price === null) continue;
    const price = Number(sku.price);
    if (Number.isFinite(price)) prices.add(price);
  }
  const sorted = [...prices].sort((left, right) => left - right);
  if (sorted.length === 0) return "—";
  const lowest = formatAmount(sorted[0]);
  const highest = formatAmount(sorted[sorted.length - 1]);
  return lowest === highest ? lowest : `${lowest} – ${highest}`;
}

/** Specs are "filled" when any structured column carries data. */
function hasSpecs(row: AdminProduct): boolean {
  return Boolean(
    row.materials?.trim() ||
      row.features?.trim() ||
      row.width !== null ||
      row.height !== null ||
      row.depth !== null,
  );
}

/** Shipping is "filled" when every SKU can be quoted by a courier. */
function hasShipping(row: AdminProduct): boolean {
  const skus = row.variants
    .map((variant) => variant.sku)
    .filter((sku): sku is NonNullable<typeof sku> => sku !== null);
  if (skus.length === 0) return false;
  return skus.every(
    (sku) =>
      sku.productWeight !== null &&
      sku.packageWidth !== null &&
      sku.packageHeight !== null &&
      sku.packageDepth !== null &&
      sku.packageWeight !== null,
  );
}

function CompletenessRow({
  label,
  complete,
}: {
  label: string;
  complete: boolean;
}): ReactNode {
  const { t } = useAdminI18n();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-secondary">{label}</span>
      <span
        className={`font-medium ${complete ? "text-success" : "text-ink-muted"}`}
      >
        {complete ? t("products_qv_complete") : t("products_qv_incomplete")}
      </span>
    </div>
  );
}

export function ProductQuickView({
  row,
  categoryName,
  onClose,
}: {
  row: AdminProduct | null;
  /** Resolved by the list (it already holds the category tree). */
  categoryName?: string;
  onClose: () => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const [detail, setDetail] = useState<AdminProduct | null>(null);
  const [landingCount, setLandingCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  // Render-phase reset (same pattern as the products list URL sync): opening
  // the drawer on a different row clears the previous product's fetched data
  // before the new fetch lands.
  const [loadedRowId, setLoadedRowId] = useState<string | null>(null);
  if (row && loadedRowId !== row.id) {
    setLoadedRowId(row.id);
    setDetail(null);
    setLandingCount(null);
    setLoading(true);
  }

  // One product, on demand: the list payload carries shared media, variants
  // and SKUs; the full graph (options + scoped media) is fetched here only.
  useEffect(() => {
    if (!row) return;
    let active = true;
    Promise.all([
      adminApi.getProduct(row.id).catch(() => null),
      adminApi.listProductLandingPages(row.id).catch(() => null),
    ]).then(([product, pages]) => {
      if (!active) return;
      setDetail(product);
      setLandingCount(pages?.length ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [row]);

  useEffect(() => {
    if (!row) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [row, onClose]);

  if (!row) return null;

  const scopedMediaCount = detail?.media?.length ?? null;
  const optionCount = detail?.options?.length ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={t("products_quick_view")}>
      <button
        type="button"
        aria-label={t("products_qv_close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink" title={row.name}>
              {row.name}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-ink-muted">
              {row.productCode ?? "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("products_qv_close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-ink-secondary hover:border-primary hover:text-cta"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge
            value={t(STATUS_LABEL_KEYS[row.status])}
            tone={STATUS_TONES[row.status]}
          />
          <span className="text-xs text-ink-secondary">
            {t(STOREFRONT_LABEL_KEYS[row.status])}
          </span>
        </div>
        {row.status !== "ACTIVE" ? (
          <p className="mt-2 rounded-lg bg-background px-3 py-2 text-xs text-ink-secondary">
            {t("products_qv_not_public")}
          </p>
        ) : null}

        {row.images.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {row.images.slice(0, 5).map((image) => (
              // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail strip.
              <img
                key={image.id}
                src={image.url}
                alt={image.altText ?? ""}
                className="h-16 w-16 rounded-lg border border-border object-cover"
                referrerPolicy="no-referrer"
              />
            ))}
          </div>
        ) : null}

        <dl className="mt-5 flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-secondary">{t("products_col_price")}</dt>
            <dd className="font-medium text-ink">{priceRange(row)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-secondary">{t("products_col_category")}</dt>
            <dd className="font-medium text-ink">{categoryName ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-secondary">{t("products_qv_skus")}</dt>
            <dd className="font-medium text-ink">{row.variants.length}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-secondary">{t("products_qv_options")}</dt>
            <dd className="font-medium text-ink">
              {optionCount === null
                ? loading
                  ? t("products_qv_loading")
                  : "—"
                : optionCount}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-secondary">{t("products_qv_media_shared")}</dt>
            <dd className="font-medium text-ink">{row.images.length}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-secondary">{t("products_qv_media_scoped")}</dt>
            <dd className="font-medium text-ink">
              {scopedMediaCount === null
                ? loading
                  ? t("products_qv_loading")
                  : "—"
                : scopedMediaCount}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
          <CompletenessRow label={t("products_qv_specs")} complete={hasSpecs(row)} />
          <CompletenessRow
            label={t("products_qv_shipping")}
            complete={hasShipping(row)}
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
          <span className="text-ink-secondary">{t("products_qv_landing")}</span>
          <Link
            href={`/admin/single-pages?productId=${row.id}`}
            className="font-semibold text-cta hover:underline"
          >
            {landingCount === null
              ? t("products_qv_manage_landing")
              : t("products_qv_landing_count", { count: landingCount })}
          </Link>
        </div>

        {/* Collections are managed on the groupings page; the product editor has
            no safe association write yet, so this only points at it. */}
        <Link
          href="/admin/groupings"
          className="mt-3 text-sm font-semibold text-cta hover:underline"
        >
          {t("products_qv_manage_groupings")}
        </Link>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          {row.status === "ACTIVE" ? (
            <a
              href={`/products/${row.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-card text-sm font-semibold text-cta hover:border-primary"
            >
              {t("products_qv_view_storefront")}
            </a>
          ) : null}
          <Link
            href={`/admin/products/${row.id}/edit`}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-cta text-sm font-semibold text-white hover:bg-cta-hover"
          >
            {t("products_qv_edit")}
          </Link>
        </div>
      </aside>
    </div>
  );
}
