"use client";

import type { ReactNode } from "react";
import type { AdminCatalogGraphDraft } from "@/lib/admin-product-graph";
import { ProductMediaScopesEditor } from "@/components/admin/ProductMediaScopesEditor";
import { useAdminI18n } from "@/lib/admin-i18n";

export interface ProductMediaPanelProps {
  graphLocked: boolean;
  graphVersion: number;
  pending: boolean;
  graphDraft: AdminCatalogGraphDraft | null;
  onGraphChange: ((mutate: (draft: AdminCatalogGraphDraft) => void) => void) | null;
  sharedGallery: ReactNode;
  detailBlocks: ReactNode;
  /** Row the problem rail asked to highlight (media row key). */
  highlightKey?: string | null;
}

/**
 * Controlled media-tab composition. ProductForm remains the sole owner of the
 * complete product value; this panel receives only the rendered shared/detail
 * slices and the graph media callback, so shared gallery rows never become
 * graph-scoped rows accidentally.
 */
export function ProductMediaPanel({
  graphLocked,
  graphVersion,
  pending,
  graphDraft,
  onGraphChange,
  sharedGallery,
  detailBlocks,
  highlightKey = null,
}: ProductMediaPanelProps): ReactNode {
  const { t } = useAdminI18n();
  return (
    <>
      {graphLocked ? (
        <div
          role="alert"
          className="rounded-xl border border-sale/40 bg-sale/5 p-4 text-sm text-red-700"
        >
          {t("product_media_graph_locked", { version: graphVersion })}
        </div>
      ) : null}
      <fieldset disabled={graphLocked} className="min-w-0">
        {sharedGallery}
      </fieldset>
      {graphDraft && onGraphChange ? (
        <section>
          <h2 className="text-base font-semibold text-ink">{t("product_media_scoped_title")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t("product_media_scoped_hint")}</p>
          <div className="mt-4">
            <ProductMediaScopesEditor
              draft={graphDraft}
              onChange={onGraphChange}
              pending={pending}
              highlightKey={highlightKey}
            />
          </div>
        </section>
      ) : null}
      {detailBlocks}
    </>
  );
}
