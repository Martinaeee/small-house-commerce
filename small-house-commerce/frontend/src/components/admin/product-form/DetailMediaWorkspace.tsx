"use client";

import type { ReactNode } from "react";
import type { DetailBlockFormValue } from "@/components/admin/ProductForm";
import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";
import { MediaGallery } from "@/components/admin/product-form/MediaGallery";
import { useMediaBatchUpload, type MediaBatchUpload, type UploadedMedia } from "@/components/admin/product-form/useMediaBatchUpload";
import { useAdminI18n } from "@/lib/admin-i18n";
import { summarizeAdminMedia } from "@/lib/admin-product-media-summary";

export interface DetailMediaWorkspaceProps {
  blocks: readonly DetailBlockFormValue[];
  pending: boolean;
  highlightKey?: string | null;
  fieldErrors?: Readonly<Record<string, string>>;
  batchUpload?: MediaBatchUpload;
  /** Shared / option-value / exact-variant choices for the per-row scope select. */
  scopeOptions: readonly { value: string; label: string }[];
  onAddMedia(media: UploadedMedia): void;
  onPatch(index: number, patch: Partial<DetailBlockFormValue>): void;
  onMove(index: number, delta: -1 | 1): void;
  onRemove(index: number): void;
}

export function DetailMediaWorkspace({ blocks, pending, highlightKey = null, fieldErrors = {}, batchUpload, scopeOptions, onAddMedia, onPatch, onMove, onRemove }: DetailMediaWorkspaceProps): ReactNode {
  const { t } = useAdminI18n();
  const localBatch = useMediaBatchUpload({ disabled: pending });
  const uploadTask = batchUpload ?? localBatch;
  const summary = summarizeAdminMedia(blocks.map((block) => ({ ...block, sortOrder: Number(block.sortOrder.trim() || "0") || 0 })));
  const highlightedKey = highlightKey?.match(/^detailBlocks\.\d+(?=\.|$)/)?.[0] ?? null;
  const scopeValueFor = (block: DetailBlockFormValue): string =>
    block.variantId
      ? `variant:${block.variantId}`
      : block.optionValueId
        ? `option:${block.optionValueId}`
        : "";
  const setScope = (index: number, value: string): void => {
    if (value.startsWith("variant:")) {
      onPatch(index, { variantId: value.slice(8), optionValueId: "" });
    } else if (value.startsWith("option:")) {
      onPatch(index, { optionValueId: value.slice(7), variantId: "" });
    } else {
      onPatch(index, { optionValueId: "", variantId: "" });
    }
  };
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-base font-semibold text-ink">{t("product_detail_title")}</h2>
          <p className="mt-1 text-sm font-medium leading-relaxed text-ink-secondary">{t("product_detail_scope_explanation")}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t("product_detail_hint")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-ink-secondary">
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_rows", { count: summary.rowCount })}</span>
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_images", { count: summary.imageCount })}</span>
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_videos", { count: summary.videoCount })}</span>
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_alt", { complete: summary.altCompleteCount, total: summary.rowCount })}</span>
        </div>
      </div>
      <MediaAddRow targetKey="detail" disabled={pending} onAddMedia={onAddMedia} batchUpload={uploadTask} />
      {blocks.length === 0 ? <p className="mt-3 text-sm text-ink-muted">{t("product_detail_empty")}</p> : null}
      <MediaGallery
          scope={t("product_detail_title")}
          listLabel={t("product_detail_blocks_aria")}
          items={blocks.map((block, index) => ({ ...block, key: `detailBlocks.${index}`, domId: `product-detail-block-${index}`, scopeValue: scopeValueFor(block) }))}
          scopeOptions={scopeOptions}
          scopeLabel={t("product_detail_scope_label")}
          onScopeChange={(key, value) => setScope(Number(key.split(".")[1]), value)}
          pending={pending || Boolean(uploadTask.uploading)}
          indexed
          highlightedKey={highlightedKey}
          problemKey={highlightedKey ? highlightKey : null}
          errors={fieldErrors}
          labels={{
            type: (number) => t("product_detail_type_aria", { number }),
            url: (number) => t("product_detail_url_aria", { number }),
            alt: (number) => t("product_detail_alt_aria", { number }),
            previous: (number) => t("product_detail_move_up", { number }),
            next: (number) => t("product_detail_move_down", { number }),
            remove: t("product_detail_remove"),
            scope: (number) => t("product_detail_scope_aria", { number }),
          }}
          onUpload={(key, file) => {
            const index = Number(key.split(".")[1]);
            return uploadTask.upload([file], { key: "detail", kind: blocks[index].type === "VIDEO" ? "video" : "image", operation: "REPLACE", onAddMedia: ({ url }) => onPatch(index, { url }) });
          }}
          onPatch={(key, patch) => onPatch(Number(key.split(".")[1]), patch)}
          onMove={(key, delta) => onMove(Number(key.split(".")[1]), delta)}
          onRemove={(key) => onRemove(Number(key.split(".")[1]))}
        />
    </section>
  );
}