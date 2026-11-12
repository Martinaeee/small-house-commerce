"use client";

import { useState, type ReactNode } from "react";
import type { DetailBlockFormValue } from "@/components/admin/ProductForm";
import { newId } from "@/lib/admin-id";
import { AdminHelpTip } from "@/components/admin/AdminHelpTip";
import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";
import { MediaGallery } from "@/components/admin/product-form/MediaGallery";
import { useMediaBatchUpload, type MediaBatchUpload, type UploadedMedia } from "@/components/admin/product-form/useMediaBatchUpload";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  detailScopeFromValue,
  detailScopeLabel,
  detailScopeValue,
  type DetailMediaScope,
} from "@/lib/admin-detail-scope";
import { summarizeAdminMedia } from "@/lib/admin-product-media-summary";

export interface DetailMediaWorkspaceProps {
  blocks: readonly DetailBlockFormValue[];
  pending: boolean;
  highlightKey?: string | null;
  fieldErrors?: Readonly<Record<string, string>>;
  batchUpload?: MediaBatchUpload;
  /** Shared / option-value / exact-variant choices for the batch and per-row scope selects. */
  scopeOptions: readonly { value: string; label: string }[];
  onAddMedia(media: UploadedMedia, scope: DetailMediaScope, opts?: { groupKey?: string }): void;
  onPatch(index: number, patch: Partial<DetailBlockFormValue>): void;
  onMove(index: number, delta: -1 | 1): void;
  onReorder?(from: number, to: number): void;
  onRemove(index: number): void;
}

export function DetailMediaWorkspace({ blocks, pending, highlightKey = null, fieldErrors = {}, batchUpload, scopeOptions, onAddMedia, onPatch, onMove, onReorder, onRemove }: DetailMediaWorkspaceProps): ReactNode {
  const { t } = useAdminI18n();
  const localBatch = useMediaBatchUpload({ disabled: pending });
  const uploadTask = batchUpload ?? localBatch;
  const [batchScope, setBatchScope] = useState("");
  // While the carousel switch is on, everything added joins one swipeable
  // group; toggling it off and on again starts a fresh group.
  const [carouselMode, setCarouselMode] = useState(false);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const handleAddMedia = (media: UploadedMedia, scope: DetailMediaScope): void => {
    if (!carouselMode) {
      onAddMedia(media, scope);
      return;
    }
    const groupKey = activeGroupKey ?? newId();
    if (!activeGroupKey) setActiveGroupKey(groupKey);
    onAddMedia(media, scope, { groupKey });
  };
  const summary = summarizeAdminMedia(blocks.map((block) => ({ ...block, sortOrder: Number(block.sortOrder.trim() || "0") || 0 })));
  const highlightedKey = highlightKey?.match(/^detailBlocks\.\d+(?=\.|$)/)?.[0] ?? null;
  const setScope = (index: number, value: string): void => {
    onPatch(index, detailScopeFromValue(value));
  };
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div className="flex items-center gap-1.5">
            <h2 className="text-base font-semibold text-ink">{t("product_detail_title")}</h2>
            <AdminHelpTip
              label={t("common_help_tip_aria")}
              text={
                <>
                  <span>{t("product_detail_scope_explanation")}</span>
                  <br />
                  <span>{t("product_detail_hint")}</span>
                </>
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-ink-secondary">
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_rows", { count: summary.rowCount })}</span>
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_images", { count: summary.imageCount })}</span>
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_videos", { count: summary.videoCount })}</span>
          <span className="rounded-full bg-background px-2.5 py-1">{t("product_media_summary_alt", { complete: summary.altCompleteCount, total: summary.rowCount })}</span>
        </div>
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={carouselMode}
          onChange={(event) => {
            setCarouselMode(event.target.checked);
            if (!event.target.checked) setActiveGroupKey(null);
          }}
          className="h-4 w-4 accent-[color:var(--color-cta)]"
        />
        {t("product_detail_carousel_mode")}
      </label>
      <MediaAddRow
        targetKey="detail"
        disabled={pending}
        onAddMedia={(media) => handleAddMedia(media, detailScopeFromValue(batchScope))}
        batchUpload={uploadTask}
        scopeOptions={scopeOptions}
        scopeValue={batchScope}
        onScopeChange={setBatchScope}
        scopeLabel={t("product_detail_upload_scope")}
      />
      {blocks.length === 0 ? <p className="mt-3 text-sm text-ink-muted">{t("product_detail_empty")}</p> : null}
      <MediaGallery
          scope={t("product_detail_title")}
          listLabel={t("product_detail_blocks_aria")}
          items={blocks.map((block, index) => {
            const scopeValue = detailScopeValue(block);
            const groupKey = block.groupKey?.trim() || null;
            const groupNumber = groupKey
              ? new Map(
                  [...new Set(blocks.map((row) => row.groupKey?.trim() || null))]
                    .filter(Boolean)
                    .map((key, position) => [key, position + 1]),
                ).get(groupKey) ?? 0
              : 0;
            return {
              ...block,
              key: `detailBlocks.${index}`,
              domId: `product-detail-block-${index}`,
              scopeValue,
              scopeLabel: groupNumber
                ? `${detailScopeLabel(scopeValue, scopeOptions)} · ${t("product_detail_carousel_chip", { index: groupNumber })}`
                : detailScopeLabel(scopeValue, scopeOptions),
            };
          })}
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
          onReorder={onReorder}
          onRemove={(key) => onRemove(Number(key.split(".")[1]))}
        />
    </section>
  );
}