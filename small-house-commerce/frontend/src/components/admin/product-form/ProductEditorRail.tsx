"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/admin/Badge";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import type { ProductStatus } from "@/lib/admin-api";
import type {
  ProductReadiness,
  ReadinessCheckKey,
  ReadinessWarningKey,
} from "@/lib/admin-product-readiness";

/**
 * The editor's read-only side rail.
 *
 * It owns no state and no rules of its own: blocking problems arrive from the
 * same issue list the save path produces, and every check is derived from the
 * live form value. Nothing here may claim "ready" while a save would fail.
 */

const CHECK_LABEL_KEYS: Record<ReadinessCheckKey, TKey> = {
  basic: "rail_check_basic",
  priced_sku: "rail_check_priced_sku",
  shared_media: "rail_check_shared_media",
  shipping: "rail_check_shipping",
  default_variant: "rail_check_default_variant",
};

const WARNING_LABEL_KEYS: Record<ReadinessWarningKey, TKey> = {
  seo: "rail_warning_seo",
  option_media: "rail_warning_option_media",
};

const STOREFRONT_KEYS: Record<ProductStatus, TKey> = {
  ACTIVE: "rail_storefront_live",
  DRAFT: "rail_storefront_draft",
  DISABLED: "rail_storefront_disabled",
};

const STATUS_LABEL_KEYS: Record<ProductStatus, TKey> = {
  ACTIVE: "product_form_status_active",
  DRAFT: "product_form_status_draft",
  DISABLED: "product_form_status_disabled",
};

const STATUS_TONES: Record<ProductStatus, "green" | "amber" | "red"> = {
  ACTIVE: "green",
  DRAFT: "amber",
  DISABLED: "red",
};

export interface ProductEditorRailProps {
  /** Blocking problems, taken from the same validation the save path runs. */
  blocking: readonly { id: string; message: string }[];
  readiness: ProductReadiness;
  storefront: {
    savedStatus: ProductStatus | null;
    selectedStatus: ProductStatus;
    /** Complete saved storefront path. Never derive this from unsaved form state. */
    path: string;
  };
  landing: { count: number | null; productId: string | null };
  preview: { name: string; coverImageUrl: string | null; priceLabel: string };
  onOpenPreview: () => void;
}

export function ProductEditorRail({
  blocking,
  readiness,
  storefront,
  landing,
  preview,
  onOpenPreview,
}: ProductEditorRailProps): ReactNode {
  const { t } = useAdminI18n();
  const publicStatus = storefront.savedStatus;
  const statusChanged =
    publicStatus !== null && publicStatus !== storefront.selectedStatus;
  const readyChecks = readiness.checks.filter((check) => check.ok);
  const recommendationChecks = readiness.checks.filter((check) => !check.ok);
  const hasRecommendations =
    recommendationChecks.length > 0 || readiness.warnings.length > 0;
  const readinessState =
    blocking.length > 0
      ? "blocking"
      : hasRecommendations
        ? "recommendation"
        : "ready";
  const stateLabel =
    readinessState === "blocking"
      ? t("rail_state_blocking")
      : readinessState === "recommendation"
        ? t("rail_state_recommendation")
        : t("rail_state_ready");
  const stateClass =
    readinessState === "blocking"
      ? "bg-admin-error-soft text-admin-error"
      : readinessState === "recommendation"
        ? "bg-admin-warning-soft text-admin-warning"
        : "bg-admin-success-soft text-admin-success";
  const progressClass =
    readinessState === "blocking"
      ? "bg-admin-error"
      : readinessState === "recommendation"
        ? "bg-admin-warning"
        : "bg-cta";

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">
            {t("rail_readiness_title")}
          </h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${stateClass}`}
          >
            {stateLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-secondary">
          {t("rail_readiness_progress", {
            done: readiness.complete,
            total: readiness.total,
          })}
        </p>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background"
          role="presentation"
        >
          <div
            className={`h-full rounded-full transition-[width] ${progressClass}`}
            style={{
              width: `${Math.round((readiness.complete / readiness.total) * 100)}%`,
            }}
          />
        </div>

        {blocking.length > 0 ? (
          <div className="mt-3 rounded-lg border border-admin-error/20 bg-admin-error-soft p-3">
            <p className="text-xs font-semibold text-admin-error">
              {t("rail_readiness_blocking")}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {blocking.map((issue) => (
                <li key={issue.id} className="text-xs leading-relaxed text-admin-error">
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {readyChecks.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {t("rail_ready_title")}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {readyChecks.map((check) => (
                <li
                  key={check.key}
                  className="flex items-start gap-2 text-xs leading-relaxed text-ink-secondary"
                >
                  <span aria-hidden className="text-success">
                    ✓
                  </span>
                  <span>{t(CHECK_LABEL_KEYS[check.key])}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasRecommendations ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-admin-warning">
              {t("rail_recommendations_title")}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {recommendationChecks.map((check) => (
                <li
                  key={check.key}
                  className="flex items-start gap-2 text-xs leading-relaxed text-admin-warning"
                >
                  <span aria-hidden>○</span>
                  <span>{t(CHECK_LABEL_KEYS[check.key])}</span>
                </li>
              ))}
              {readiness.warnings.map((warning, index) => (
                <li
                  key={`${warning.key}:${warning.name ?? index}`}
                  className="flex items-start gap-2 text-xs leading-relaxed text-admin-warning"
                >
                  <span aria-hidden>⚠</span>
                  <span>
                    {warning.name
                      ? t(WARNING_LABEL_KEYS[warning.key], {
                          name: warning.name,
                        })
                      : t(WARNING_LABEL_KEYS[warning.key])}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <section className="p-4">
          <h2 className="text-sm font-semibold text-ink">
            {t("rail_storefront_title")}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {publicStatus ? (
              <Badge
                value={t(STATUS_LABEL_KEYS[publicStatus])}
                tone={STATUS_TONES[publicStatus]}
              />
            ) : null}
            <span className="text-xs text-ink-secondary">
              {publicStatus
                ? t(STOREFRONT_KEYS[publicStatus])
                : t("rail_storefront_unknown")}
            </span>
          </div>
          {statusChanged && publicStatus ? (
            <p className="mt-2 rounded-lg bg-admin-warning-soft px-3 py-2 text-xs leading-relaxed text-admin-warning">
              {t("rail_storefront_unsaved", {
                selected: t(STATUS_LABEL_KEYS[storefront.selectedStatus]),
                saved: t(STATUS_LABEL_KEYS[publicStatus]),
              })}
            </p>
          ) : null}
          {publicStatus === "ACTIVE" ? (
            <a
              href={storefront.path}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-semibold text-cta hover:underline"
            >
              {t("rail_preview_store")}
            </a>
          ) : null}
        </section>

        <section className="p-4">
          <h2 className="text-sm font-semibold text-ink">
            {t("rail_landing_title")}
          </h2>
          <p className="mt-1 text-sm text-ink">
            {landing.count === null
              ? t("rail_landing_unknown")
              : t("rail_landing_count", { count: landing.count })}
          </p>
          <Link
            href={
              landing.productId
                ? `/admin/single-pages?productId=${landing.productId}`
                : "/admin/single-pages"
            }
            className="mt-2 inline-block text-xs font-semibold text-cta hover:underline"
          >
            {t("rail_landing_manage")}
          </Link>
        </section>

        <section className="p-4">
          <h2 className="text-sm font-semibold text-ink">
            {t("rail_preview_title")}
          </h2>
          <div className="mt-2 flex gap-3">
            {preview.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail of an already-uploaded asset.
              <img
                src={preview.coverImageUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg border border-border object-cover"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div className="min-w-0">
              <p
                className="truncate text-sm font-medium text-ink"
                title={preview.name}
              >
                {preview.name || t("rail_preview_untitled")}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink">
                {preview.priceLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenPreview}
            className="mt-3 h-9 w-full rounded-lg border border-border bg-card text-xs font-semibold text-cta hover:border-primary"
          >
            {t("rail_preview_open")}
          </button>
        </section>
      </div>
    </div>
  );
}
