"use client";

import type { ReactNode } from "react";
import type { DetailBlockFormValue } from "@/components/admin/ProductForm";
import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";
import { MediaGallery } from "@/components/admin/product-form/MediaGallery";
import { useMediaBatchUpload, type MediaBatchUpload, type UploadedMedia } from "@/components/admin/product-form/useMediaBatchUpload";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { summarizeAdminMedia } from "@/lib/admin-product-media-summary";

export interface DetailMediaWorkspaceProps {
  blocks: readonly DetailBlockFormValue[];
  pending: boolean;
  highlightKey?: string | null;
  fieldErrors?: Readonly<Record<string, string>>;
  batchUpload?: MediaBatchUpload;
  onAddMedia(media: UploadedMedia): void;
  onPatch(index: number, patch: Partial<DetailBlockFormValue>): void;
  onMove(index: number, delta: -1 | 1): void;
  onRemove(index: number): void;
  onAdd(type: "IMAGE" | "VIDEO"): void;
}

export function DetailMediaWorkspace({ blocks, pending, highlightKey = null, fieldErrors = {}, batchUpload, onAddMedia, onPatch, onMove, onRemove, onAdd }: DetailMediaWorkspaceProps): ReactNode {
  const { t } = useAdminI18n();
  const localBatch = useMediaBatchUpload({ disabled: pending });
  const uploadTask = batchUpload ?? localBatch;
  const summary = summarizeAdminMedia(blocks.map((block) => ({ ...block, sortOrder: Number(block.sortOrder.trim() || "0") || 0 })));
  const highlightedKey = highlightKey?.match(/^detailBlocks\.\d+(?=\.|$)/)?.[0] ?? null;
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
          items={blocks.map((block, index) => ({ ...block, key: `detailBlocks.${index}`, domId: `product-detail-block-${index}` }))}
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
          }}
          onUpload={(key, file) => {
            const index = Number(key.split(".")[1]);
            return uploadTask.upload([file], { key: "detail", kind: blocks[index].type === "VIDEO" ? "video" : "image", operation: "REPLACE", onAddMedia: ({ url }) => onPatch(index, { url }) });
          }}
          onPatch={(key, patch) => onPatch(Number(key.split(".")[1]), patch)}
          onMove={(key, delta) => onMove(Number(key.split(".")[1]), delta)}
          onRemove={(key) => onRemove(Number(key.split(".")[1]))}
        />
      <details className="mt-3 text-xs text-ink-muted">
        <summary className="cursor-pointer">{t("product_media_manual_add")}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="md" onClick={() => onAdd("IMAGE")} disabled={pending || Boolean(uploadTask.uploading)}>{t("product_detail_add_image")}</Button>
          <Button type="button" variant="secondary" size="md" onClick={() => onAdd("VIDEO")} disabled={pending || Boolean(uploadTask.uploading)}>{t("product_detail_add_video")}</Button>
        </div>
      </details>
    </section>
  );
}
