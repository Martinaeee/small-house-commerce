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
  fieldErrors?: Readonly<Record<string, string>>;
  onPatch(index: number, patch: Partial<ImageFormValue>): void;
  onMove(index: number, delta: -1 | 1): void;
  onReorder(from: number, to: number): void;
  onSetCover(index: number): void;
  onRemove(index: number): void;
  onAdd(type: "IMAGE" | "VIDEO"): void;
}

const overlayActionCls =
  "inline-flex h-6 min-w-6 items-center justify-center rounded bg-white/90 px-1 text-[11px] font-semibold text-ink hover:bg-white disabled:cursor-not-allowed disabled:opacity-40";

function belongsToImage(highlightKey: string | null, index: number): boolean {
  return (
    highlightKey === `images.${index}` ||
    highlightKey?.startsWith(`images.${index}.`) === true
  );
}

function indexAfterMove(
  current: number | null,
  from: number,
  to: number,
): number | null {
  if (current === null || from === to) return current;
  if (current === from) return to;
  if (from < to && current > from && current <= to) return current - 1;
  if (from > to && current >= to && current < from) return current + 1;
  return current;
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
  fieldErrors = {},
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
  const highlightedImageMatch = highlightKey?.match(/^images\.(\d+)(?:\.|$)/);
  const highlightedImageIndex = highlightedImageMatch
    ? Number(highlightedImageMatch[1])
    : null;
  const editorIndex =
    highlightedImageIndex !== null && highlightedImageIndex < images.length
      ? highlightedImageIndex
      : activeIndex;
  const activeImage =
    editorIndex !== null && editorIndex < images.length
      ? images[editorIndex]
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
          className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(88px,104px))] justify-start gap-2"
        >
          {images.map((image, index) => {
            const sortOrder = Number(image.sortOrder.trim() || "0") || 0;
            const isCover = sortOrder === coverSortOrder;
            const expanded = editorIndex === index;
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
                  const from = dragFrom.current;
                  if (!pending && from !== null) {
                    setActiveIndex((current) =>
                      indexAfterMove(current, from, index),
                    );
                    onReorder(from, index);
                  }
                  dragFrom.current = null;
                }}
                className={`group relative overflow-hidden rounded-lg bg-background ${
                  highlighted || isCover
                    ? "ring-2 ring-cta ring-offset-1"
                    : "border border-border"
                }`}
              >
                <div
                  id={
                    highlightKey === `images.${index}`
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
                    <span className="absolute left-1 top-1 rounded-full bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {t("product_media_order", { position: index + 1 })}
                    </span>
                    {isCover ? (
                      <span className="absolute right-1 top-1 rounded-full bg-cta px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {t("product_media_cover")}
                      </span>
                    ) : null}
                  </button>

                  <div
                    data-media-actions
                    className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-ink/70 px-0.5 py-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                  >
                    <button
                      type="button"
                      className={overlayActionCls}
                      onClick={() => {
                        setActiveIndex((current) =>
                          indexAfterMove(current, index, index - 1),
                        );
                        onMove(index, -1);
                      }}
                      disabled={pending || index === 0}
                      aria-label={t("product_media_move_left", {
                        number: index + 1,
                      })}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className={overlayActionCls}
                      onClick={() => {
                        setActiveIndex((current) =>
                          indexAfterMove(current, index, index + 1),
                        );
                        onMove(index, 1);
                      }}
                      disabled={pending || index === images.length - 1}
                      aria-label={t("product_media_move_right", {
                        number: index + 1,
                      })}
                    >
                      →
                    </button>
                    {!isCover ? (
                      <button
                        type="button"
                        className={overlayActionCls}
                        onClick={() => {
                          setActiveIndex((current) =>
                            indexAfterMove(current, index, 0),
                          );
                          onSetCover(index);
                        }}
                        disabled={pending}
                        aria-label={t("product_media_set_cover")}
                      >
                        ★
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={overlayActionCls}
                      onClick={() => {
                        setActiveIndex((current) => {
                          if (current === null) return null;
                          if (current === index) return null;
                          return current > index ? current - 1 : current;
                        });
                        onRemove(index);
                      }}
                      disabled={pending}
                      aria-label={t("product_media_remove")}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {activeImage && editorIndex !== null ? (
        <div
          id="shared-media-editor"
          className="mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 md:grid-cols-2"
        >
          <div
            id={
              highlightKey === `images.${editorIndex}.type`
                ? `pf-row-${highlightKey}`
                : undefined
            }
          >
            <Field
              label={t("product_media_type_label")}
              htmlFor={`pf-images-${editorIndex}-type`}
            >
              <Select
                id={`pf-images-${editorIndex}-type`}
                aria-label={t("product_media_type_aria", {
                  number: editorIndex + 1,
                })}
                value={activeImage.type}
                onChange={(event) =>
                  onPatch(editorIndex, {
                    type: event.target.value as ImageFormValue["type"],
                  })
                }
                disabled={pending}
              >
                <option value="IMAGE">{t("product_media_type_image")}</option>
                <option value="VIDEO">{t("product_media_type_video")}</option>
              </Select>
            </Field>
          </div>
          <div
            id={
              highlightKey === `images.${editorIndex}.altText`
                ? `pf-row-${highlightKey}`
                : undefined
            }
          >
            <Field
              label={t("product_media_alt_label")}
              htmlFor={`pf-images-${editorIndex}-alt`}
              error={fieldErrors[`images.${editorIndex}.altText`]}
            >
              <TextInput
                id={`pf-images-${editorIndex}-alt`}
                aria-label={t("product_media_alt_aria", {
                  number: editorIndex + 1,
                })}
                value={activeImage.altText}
                onChange={(event) =>
                  onPatch(editorIndex, { altText: event.target.value })
                }
                disabled={pending}
                autoComplete="off"
              />
            </Field>
          </div>
          <div
            id={
              highlightKey === `images.${editorIndex}.url`
                ? `pf-row-${highlightKey}`
                : undefined
            }
            className="md:col-span-2"
          >
            <Field
              label={
                activeImage.type === "VIDEO"
                  ? t("product_media_url_video_label")
                  : t("product_media_url_image_label")
              }
              htmlFor={`pf-images-${editorIndex}-url`}
              error={fieldErrors[`images.${editorIndex}.url`]}
            >
              <ImageUrlInput
                id={`pf-images-${editorIndex}-url`}
                ariaLabel={t("product_media_url_aria", {
                  number: editorIndex + 1,
                })}
                kind={activeImage.type === "VIDEO" ? "video" : "image"}
                value={activeImage.url}
                onChange={(url) => onPatch(editorIndex, { url })}
                disabled={pending}
              />
            </Field>
          </div>
          <details
            open={
              Boolean(fieldErrors[`images.${editorIndex}.sortOrder`]) ||
              undefined
            }
            className="md:col-span-2"
          >
            <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">
              {t("product_media_advanced")}
            </summary>
            <div
              id={
                highlightKey === `images.${editorIndex}.sortOrder`
                  ? `pf-row-${highlightKey}`
                  : undefined
              }
              className="mt-2 max-w-xs"
            >
              <Field
                label={t("product_media_sort_label")}
                htmlFor={`pf-images-${editorIndex}-sort`}
                error={fieldErrors[`images.${editorIndex}.sortOrder`]}
              >
                <TextInput
                  id={`pf-images-${editorIndex}-sort`}
                  aria-label={t("product_media_sort_aria", {
                    number: editorIndex + 1,
                  })}
                  inputMode="numeric"
                  value={activeImage.sortOrder}
                  onChange={(event) =>
                    onPatch(editorIndex, { sortOrder: event.target.value })
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
