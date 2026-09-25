"use client";

import type { ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import type { DetailBlockFormValue } from "@/components/admin/ProductForm";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { summarizeAdminMedia } from "@/lib/admin-product-media-summary";

export interface DetailMediaWorkspaceProps {
  blocks: readonly DetailBlockFormValue[];
  pending: boolean;
  highlightKey?: string | null;
  onPatch(index: number, patch: Partial<DetailBlockFormValue>): void;
  onMove(index: number, delta: -1 | 1): void;
  onRemove(index: number): void;
  onAdd(type: "IMAGE" | "VIDEO"): void;
}

const rowActionCls =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border bg-card px-2 text-xs font-semibold text-ink-secondary hover:border-primary hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted";

function belongsToBlock(highlightKey: string | null, index: number): boolean {
  return (
    highlightKey === `detailBlocks.${index}` ||
    highlightKey?.startsWith(`detailBlocks.${index}.`) === true
  );
}

/** Controlled PDP long-form media editor; ProductForm owns every block. */
export function DetailMediaWorkspace({
  blocks,
  pending,
  highlightKey = null,
  onPatch,
  onMove,
  onRemove,
  onAdd,
}: DetailMediaWorkspaceProps): ReactNode {
  const { t } = useAdminI18n();
  const summary = summarizeAdminMedia(
    blocks.map((block) => ({
      url: block.url,
      type: block.type,
      altText: block.altText,
      sortOrder: Number(block.sortOrder.trim() || "0") || 0,
    })),
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-base font-semibold text-ink">
            {t("product_detail_title")}
          </h2>
          <p className="mt-1 text-sm font-medium leading-relaxed text-ink-secondary">
            {t("product_detail_scope_explanation")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {t("product_detail_hint")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-ink-secondary">
          <span className="rounded-full bg-background px-2.5 py-1">
            {t("product_media_summary_rows", { count: summary.rowCount })}
          </span>
          <span className="rounded-full bg-background px-2.5 py-1">
            {t("product_media_summary_images", { count: summary.imageCount })}
          </span>
          <span className="rounded-full bg-background px-2.5 py-1">
            {t("product_media_summary_videos", { count: summary.videoCount })}
          </span>
          <span className="rounded-full bg-background px-2.5 py-1">
            {t("product_media_summary_alt", {
              complete: summary.altCompleteCount,
              total: summary.rowCount,
            })}
          </span>
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          {t("product_detail_empty")}
        </p>
      ) : (
        <ul
          aria-label={t("product_detail_blocks_aria")}
          className="mt-4 flex flex-col gap-3"
        >
          {blocks.map((block, index) => {
            const highlighted = belongsToBlock(highlightKey, index);
            return (
              <li
                id={`product-detail-block-${index}`}
                key={index}
                className={`grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-2 xl:grid-cols-[120px_minmax(0,1fr)_minmax(180px,240px)_auto] xl:items-end ${
                  highlighted ? "ring-2 ring-cta ring-offset-1" : ""
                }`}
              >
                <div
                  id={
                    highlighted && highlightKey
                      ? `pf-row-${highlightKey}`
                      : undefined
                  }
                  className="min-w-0"
                >
                  <Field
                    label={t("product_detail_type_label")}
                    htmlFor={`pf-detail-${index}-type`}
                  >
                    <Select
                      id={`pf-detail-${index}-type`}
                      aria-label={t("product_detail_type_aria", {
                        number: index + 1,
                      })}
                      value={block.type}
                      onChange={(event) =>
                        onPatch(index, {
                          type: event.target
                            .value as DetailBlockFormValue["type"],
                        })
                      }
                      disabled={pending}
                    >
                      <option value="IMAGE">
                        {t("product_detail_type_image")}
                      </option>
                      <option value="VIDEO">
                        {t("product_detail_type_video")}
                      </option>
                    </Select>
                  </Field>
                </div>

                <div className="min-w-0">
                  <Field
                    label={t("product_detail_url_label")}
                    htmlFor={`pf-detail-${index}-url`}
                    hint={
                      block.type === "VIDEO"
                        ? t("product_detail_url_video_hint")
                        : t("product_detail_url_image_hint")
                    }
                  >
                    <ImageUrlInput
                      id={`pf-detail-${index}-url`}
                      ariaLabel={t("product_detail_url_aria", {
                        number: index + 1,
                      })}
                      kind={block.type === "VIDEO" ? "video" : "image"}
                      placeholder={
                        block.type === "VIDEO"
                          ? "https://…/product-demo.mp4"
                          : "https://…"
                      }
                      value={block.url}
                      onChange={(url) => onPatch(index, { url })}
                      disabled={pending}
                    />
                  </Field>
                </div>

                <div className="min-w-0">
                  <Field
                    label={t("product_media_alt_label")}
                    htmlFor={`pf-detail-${index}-alt`}
                    hint={t("product_detail_alt_hint")}
                  >
                    <TextInput
                      id={`pf-detail-${index}-alt`}
                      aria-label={t("product_detail_alt_aria", {
                        number: index + 1,
                      })}
                      value={block.altText}
                      onChange={(event) =>
                        onPatch(index, { altText: event.target.value })
                      }
                      disabled={pending}
                      autoComplete="off"
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    className={rowActionCls}
                    onClick={() => onMove(index, -1)}
                    disabled={pending || index === 0}
                    aria-label={t("product_detail_move_up", {
                      number: index + 1,
                    })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={rowActionCls}
                    onClick={() => onMove(index, 1)}
                    disabled={pending || index === blocks.length - 1}
                    aria-label={t("product_detail_move_down", {
                      number: index + 1,
                    })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={rowActionCls}
                    onClick={() => onRemove(index)}
                    disabled={pending}
                  >
                    {t("product_detail_remove")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => onAdd("IMAGE")}
          disabled={pending}
        >
          {t("product_detail_add_image")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => onAdd("VIDEO")}
          disabled={pending}
        >
          {t("product_detail_add_video")}
        </Button>
      </div>
    </section>
  );
}
