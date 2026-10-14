"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { entityRowKey, setVariantCardImage, type AdminCatalogGraphDraft, type EntityRef } from "@/lib/admin-product-graph";
import { MediaUploadResults } from "./MediaAddRow";
import type { MediaBatchUpload } from "./useMediaBatchUpload";

export interface ProductCardMediaEditorProps {
  draft: AdminCatalogGraphDraft;
  onChange: (mutate: (draft: AdminCatalogGraphDraft) => void) => void;
  batchUpload: MediaBatchUpload;
  pending: boolean;
  onPreviewVariant: (ref: EntityRef) => void;
}

const actionClass = "rounded border border-border px-2 py-1 text-xs font-semibold text-ink-secondary hover:border-primary disabled:cursor-not-allowed disabled:opacity-40";

export function ProductCardMediaEditor({ draft, onChange, batchUpload, pending, onPreviewVariant }: ProductCardMediaEditorProps): ReactNode {
  const { t } = useAdminI18n();
  const [picker, setPicker] = useState<{ variantRef: EntityRef; slot: "cover" | "hover" } | null>(null);
  const [expandedReceipts, setExpandedReceipts] = useState<Record<string, boolean>>({});
  const busy = pending || batchUpload.uploading;
  const gallery = draft.media.filter(row => row.type === "IMAGE" && row.url.trim() !== "");
  const labels = new Map(draft.options.flatMap(option => option.values.map(value => [entityRowKey(value), value.label] as const)));

  return (
    <section className="min-w-0">
      <h2 className="text-base font-semibold text-ink">{t("product_card_media_title")}</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t("product_card_media_hint")}</p>
      {draft.variants.length === 0 ? <p className="mt-3 text-sm text-ink-muted">{t("product_card_empty")}</p> : (
        <div className="mt-3 space-y-3">
          {draft.variants.map(variant => {
            const variantKey = entityRowKey(variant);
            const ref = variant.id !== undefined ? { id: variant.id } : { clientKey: variant.clientKey! };
            const name = variant.optionValueRefs.map(value => labels.get(entityRowKey(value))).filter(Boolean).join(" / ") || variant.name;
            const isDefault = Boolean(draft.defaultDisplayVariantRef && entityRowKey(draft.defaultDisplayVariantRef) === variantKey);
            const canBeDefault = variant.sku?.status === "ACTIVE" && variant.sku.price !== null;
            return (
              <div key={variantKey} className="min-w-0 rounded-lg border border-border p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-ink">{name}</h3>
                    {!variant.cardMedia?.cover ? <p className="mt-0.5 text-xs text-red-700">{t("product_card_missing_cover")}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={actionClass} aria-label={`${name} ${t("product_card_preview")}`} disabled={busy} onClick={() => onPreviewVariant(ref)}>{t("product_card_preview")}</button>
                    <button type="button" className={actionClass} aria-label={`${name} ${t("product_card_set_default")}`} aria-pressed={isDefault} disabled={busy || !canBeDefault}
                      onClick={() => onChange(next => { next.defaultDisplayVariantRef = ref; })}>
                      {t(isDefault ? "product_card_default" : "product_card_set_default")}
                    </button>
                  </div>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {(["cover", "hover"] as const).map(slot => {
                    const image = variant.cardMedia?.[slot] ?? null;
                    const slotName = t(slot === "cover" ? "product_card_cover" : "product_card_hover");
                    const key = `card:${variantKey}:${slot}`;
                    const aria = (action: string) => t("product_card_action_aria", { variant: name, slot: slotName, action });
                    return (
                      <div key={slot} className="min-w-0 space-y-2 rounded-lg bg-background p-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {image ? (
                            // eslint-disable-next-line @next/next/no-img-element -- admin previews accept external gallery URLs.
                            <img src={image.url} alt={image.altText ?? slotName} referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded object-contain bg-white" />
                          ) : <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-white text-ink-muted">—</span>}
                          <span className="text-xs font-semibold text-ink">{slotName}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <label className={`${actionClass} ${busy ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
                            {t("product_card_upload")}
                            <input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" className="sr-only" aria-label={aria(t("product_card_upload"))} disabled={busy}
                              onChange={event => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (!file || busy) return;
                                setExpandedReceipts(previous => ({ ...previous, [key]: false }));
                                void batchUpload.upload([file], {
                                  key, kind: "image", operation: "REPLACE",
                                  onAddMedia: media => onChange(next => setVariantCardImage(next, ref, slot, { type: "IMAGE", url: media.url, altText: null })),
                                });
                              }} />
                          </label>
                          <button type="button" className={actionClass} aria-label={aria(t("product_card_choose_gallery"))} disabled={busy} onClick={() => setPicker({ variantRef: ref, slot })}>{t("product_card_choose_gallery")}</button>
                          <button type="button" className={actionClass} aria-label={aria(t("product_card_clear"))} disabled={busy || image === null} onClick={() => onChange(next => setVariantCardImage(next, ref, slot, null))}>{t("product_card_clear")}</button>
                        </div>
                        {image ? <input type="text" className="w-full min-w-0 rounded border border-border bg-card px-2 py-1 text-xs text-ink" aria-label={aria(t("product_card_alt"))} placeholder={t("product_card_alt")} value={image.altText ?? ""} maxLength={255} disabled={busy}
                          onChange={event => onChange(next => setVariantCardImage(next, ref, slot, { ...image, altText: event.target.value || null }))} /> : null}
                        <MediaUploadResults batchUpload={batchUpload} targetKey={key} expanded={expandedReceipts[key] ?? false} onExpandedChange={expanded => setExpandedReceipts(previous => ({ ...previous, [key]: expanded }))} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={picker !== null} onClose={() => setPicker(null)} title={t("product_card_gallery_title")} initialFocus="first">
        {gallery.length === 0 ? <p className="text-sm text-ink-muted">{t("product_card_gallery_empty")}</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {gallery.map((row, index) => <button key={entityRowKey(row)} type="button" className="min-w-0 overflow-hidden rounded border border-border p-1 hover:border-primary disabled:opacity-40" aria-label={t("product_card_gallery_image", { number: index + 1 })} disabled={busy}
              onClick={() => {
                if (!picker) return;
                onChange(next => setVariantCardImage(next, picker.variantRef, picker.slot, { type: "IMAGE", url: row.url, altText: row.altText }));
                setPicker(null);
              }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- admin previews accept external gallery URLs. */}
              <img src={row.url} alt={row.altText ?? ""} referrerPolicy="no-referrer" className="aspect-square w-full object-contain bg-white" />
            </button>)}
          </div>
        )}
      </Dialog>
    </section>
  );
}
