"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ProductStatus } from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";
import { LivePreview, StorefrontPreview, type PreviewPaneLabels } from "@/components/admin/PreviewPane";

export interface SavedProductPreview {
  path: string;
  status: ProductStatus;
}

export interface ProductPreviewPanelProps {
  children: ReactNode;
  savedPreview: SavedProductPreview | null;
  currentSlug: string;
  currentStatus: ProductStatus;
}

export function ProductPreviewPanel({
  children,
  savedPreview,
  currentSlug,
  currentStatus,
}: ProductPreviewPanelProps): ReactNode {
  const { t } = useAdminI18n();
  const currentPath = currentSlug.trim() ? `/products/${currentSlug.trim()}` : null;
  const hasUnsavedChanges =
    savedPreview !== null &&
    (currentPath !== savedPreview.path || currentStatus !== savedPreview.status);
  const savedIsActive = savedPreview?.status === "ACTIVE";
  const previewLabels: PreviewPaneLabels = {
    desktopDevice: t("product_form_preview_desktop_device"),
    mobileDevice: t("product_form_preview_mobile_device"),
    refresh: t("product_form_preview_refresh"),
    savedNote: t("product_form_preview_saved_path"),
    desktopTitle: t("product_form_preview_desktop_title"),
    mobileTitle: t("product_form_preview_mobile_title"),
    liveNote: t("product_form_preview_live"),
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Product editor preview: on narrow screens the desktop frame hides so
          the mobile view leads (the frames still fit their container). */}
      <LivePreview labels={previewLabels} preferMobileOnNarrow>
        {children}
      </LivePreview>
      <div className="border-t border-border pt-4">
        <h4 className="text-xs font-semibold text-ink-secondary">
          {t("product_form_preview_saved_heading")}
        </h4>
        {savedIsActive && savedPreview ? (
          <>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {t("product_form_preview_saved_active")}
            </p>
            {hasUnsavedChanges ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {t("product_form_preview_unsaved")}
              </p>
            ) : null}
            <Link
              href={savedPreview.path}
              target="_blank"
              rel="noreferrer"
              aria-label={t("product_form_preview_open_saved")}
              className="mt-3 inline-flex text-xs font-semibold text-cta hover:underline"
            >
              {t("product_form_preview_open_saved")}
            </Link>
            <div className="mt-3">
              <StorefrontPreview
                path={savedPreview.path}
                labels={previewLabels}
                preferMobileOnNarrow
              />
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {savedPreview === null
                ? t("product_form_preview_new_unavailable")
                : t("product_form_preview_inactive_unavailable")}
            </p>
            {hasUnsavedChanges ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {t("product_form_preview_unsaved")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
