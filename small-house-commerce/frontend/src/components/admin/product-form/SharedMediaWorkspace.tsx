"use client";

import { useRef, useState, type ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import type { ImageFormValue } from "@/components/admin/ProductForm";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { summarizeAdminMedia } from "@/lib/admin-product-media-summary";

export interface SharedMediaWorkspaceProps {
  images: readonly ImageFormValue[];
  pending: boolean;
  highlightKey?: string | null;
  onPatch(index: number, patch: Partial<ImageFormValue>): void;
  onMove(index: number, delta: -1 | 1): void;
  onReorder(from: number, to: number): void;
  onSetCover(index: number): void;
  onRemove(index: number): void;
  onAdd(type: "IMAGE" | "VIDEO"): void;
}

const compactActionCls =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border bg-card px-2 text-xs font-semibold text-ink-secondary hover:border-primary hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted";

function belongsToImage(highlightKey: string | null, index: number): boolean {
  return (
    highlightKey === `images.${index}` ||
    highlightKey?.startsWith(`images.${index}.`) === true
  );
}

/**
 * Controlled editor for the product's default gallery. The form owns every
 * row and every mutation; this workspace keeps only which card is expanded
 * and the source index of the current drag gesture.
 */
export function SharedMediaWorkspace({
  images,
  pending,
  highlightKey = null,
  onPatch,
  onMove,
  onReorder,
  onSetCover,
  onRemove,
  onAdd,
}: SharedMediaWorkspaceProps): ReactNode {
  const { t } = useAdminI18n();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const summary = summarizeAdminMedia(
    images.map((image) => ({
      url: image.url,
      type: image.type,
      altText: image.altText,
      sortOrder: Number(image.sortOrder.trim() || "0") || 0,
    })),
  );
  const coverSortOrder =
    images.length > 0
      ? Math.min(
          ...images.map(
            (image) => Number(image.sortOrder.trim() || "0") || 0,
          ),
        )
      : 0;
  const activeImage =
    activeIndex !== null && activeIndex < images.length
      ? images[activeIndex]
      : null;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {t("product_media_shared_title")}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {t("product_media_gallery_hint")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-ink-secondary">
          <span className="rounded-full bg-background px-2.5 py-1">
            {t("product_media_summary_rows", { count: summary.rowCount })}
          </span>
          <span className="rounded-full bg-background px-2.5 py-1">
            {t("product_media_summary_usable", { count: summary.usableCount })}
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

      {images.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          {t("product_media_empty")}
        </p>
      ) : (
        <ul
          aria-label={t("product_media_cards_aria")}
          className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(140px,160px))] justify-start gap-3"
        >
          {images.map((image, index) => {
            const sortOrder = Number(image.sortOrder.trim() || "0") || 0;
            const isCover = sortOrder === coverSortOrder;
            const expanded = activeIndex === index;
            const highlighted = belongsToImage(highlightKey, index);
            return (
              <li
                id={`product-media-image-${index}`}
                key={index}
                draggable={!pending}
                onDragStart={(event) => {
                  if (pending) {
                    event.preventDefault();
                    return;
                  }
                  dragFrom.current = index;
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
                }}
                onDragOver={(event) => {
                  if (!pending) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!pending && dragFrom.current !== null) {
                    onReorder(dragFrom.current, index);
                  }
                  dragFrom.current = null;
                }}
                className={`overflow-hidden rounded-lg bg-background ${
                  highlighted || isCover
                    ? "ring-2 ring-cta ring-offset-1"
                    : "border border-border"
                }`}
              >
                <div
                  id={
                    highlighted && highlightKey
                      ? `pf-row-${highlightKey}`
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setActiveIndex(expanded ? null : index)
                    }
                    aria-expanded={expanded}
                    aria-controls="shared-media-editor"
                    aria-label={
                      isCover
                        ? t("product_media_card_cover_aria", {
                            number: index + 1,
                          })
                        : t("product_media_card_aria", { number: index + 1 })
                    }
                    className="relative block aspect-square w-full cursor-grab active:cursor-grabbing"
                  >
                    {image.url.trim() ? (
                      image.type === "VIDEO" ? (
                        <video
                          src={image.url}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- admin-only external URL preview.
                        <img
                          src={image.url}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                          referrerPolicy="no-referrer"
                        />
                      )
                    ) : (
                      <span className="flex h-full items-center justify-center px-2 text-center text-xs text-ink-muted">
                        {image.type === "VIDEO"
                          ? t("product_media_empty_video")
                          : t("product_media_empty_image")}
                      </span>
                    )}
                    {image.type === "VIDEO" ? (
                      <span
                        aria-hidden
                        className="absolute inset-0 flex items-center justify-center text-2xl text-white drop-shadow"
                      >
                        ▶
                      </span>
                    ) : null}
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {t("product_media_order", { position: index + 1 })}
                    </span>
                    {isCover ? (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-cta px-2 py-0.5 text-[11px] font-semibold text-white">
                        {t("product_media_cover")}
                      </span>
                    ) : null}
                  </button>

                  <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={compactActionCls}
                        onClick={() => onMove(index, -1)}
                        disabled={pending || index === 0}
                        aria-label={t("product_media_move_left", {
                          number: index + 1,
                        })}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        className={compactActionCls}
                        onClick={() => onMove(index, 1)}
                        disabled={pending || index === images.length - 1}
                        aria-label={t("product_media_move_right", {
                          number: index + 1,
                        })}
                      >
                        →
                      </button>
                    </div>
                    {!isCover ? (
                      <button
                        type="button"
                        onClick={() => onSetCover(index)}
                        disabled={pending}
                        className="text-[11px] font-semibold text-cta hover:underline disabled:text-ink-muted disabled:no-underline"
                      >
                        {t("product_media_set_cover")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={compactActionCls}
                      onClick={() => {
                        setActiveIndex(null);
                        onRemove(index);
                      }}
                      disabled={pending}
                    >
                      {t("product_media_remove")}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {activeImage && activeIndex !== null ? (
        <div
          id="shared-media-editor"
          className="mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 md:grid-cols-2"
        >
          <Field
            label={t("product_media_type_label")}
            htmlFor={`pf-images-${activeIndex}-type`}
          >
            <Select
              id={`pf-images-${activeIndex}-type`}
              aria-label={t("product_media_type_aria", {
                number: activeIndex + 1,
              })}
              value={activeImage.type}
              onChange={(event) =>
                onPatch(activeIndex, {
                  type: event.target.value as ImageFormValue["type"],
                })
              }
              disabled={pending}
            >
              <option value="IMAGE">{t("product_media_type_image")}</option>
              <option value="VIDEO">{t("product_media_type_video")}</option>
            </Select>
          </Field>
          <Field
            label={t("product_media_alt_label")}
            htmlFor={`pf-images-${activeIndex}-alt`}
          >
            <TextInput
              id={`pf-images-${activeIndex}-alt`}
              aria-label={t("product_media_alt_aria", {
                number: activeIndex + 1,
              })}
              value={activeImage.altText}
              onChange={(event) =>
                onPatch(activeIndex, { altText: event.target.value })
              }
              disabled={pending}
              autoComplete="off"
            />
          </Field>
          <div className="md:col-span-2">
            <Field
              label={
                activeImage.type === "VIDEO"
                  ? t("product_media_url_video_label")
                  : t("product_media_url_image_label")
              }
              htmlFor={`pf-images-${activeIndex}-url`}
            >
              <ImageUrlInput
                id={`pf-images-${activeIndex}-url`}
                ariaLabel={t("product_media_url_aria", {
                  number: activeIndex + 1,
                })}
                kind={activeImage.type === "VIDEO" ? "video" : "image"}
                value={activeImage.url}
                onChange={(url) => onPatch(activeIndex, { url })}
                disabled={pending}
              />
            </Field>
          </div>
          <details className="md:col-span-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">
              {t("product_media_advanced")}
            </summary>
            <div className="mt-2 max-w-xs">
              <Field
                label={t("product_media_sort_label")}
                htmlFor={`pf-images-${activeIndex}-sort`}
              >
                <TextInput
                  id={`pf-images-${activeIndex}-sort`}
                  aria-label={t("product_media_sort_aria", {
                    number: activeIndex + 1,
                  })}
                  inputMode="numeric"
                  value={activeImage.sortOrder}
                  onChange={(event) =>
                    onPatch(activeIndex, { sortOrder: event.target.value })
                  }
                  disabled={pending}
                  autoComplete="off"
                />
              </Field>
            </div>
          </details>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => {
            setActiveIndex(images.length);
            onAdd("IMAGE");
          }}
          disabled={pending}
        >
          {t("product_media_add_image")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => {
            setActiveIndex(images.length);
            onAdd("VIDEO");
          }}
          disabled={pending}
        >
          {t("product_media_add_video")}
        </Button>
      </div>
    </section>
  );
}
