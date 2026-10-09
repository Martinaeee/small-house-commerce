"use client";

import { useId, useState, type ReactNode } from "react";
import { Field, Select, TextInput } from "@/components/admin/Field";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";
import { useAdminI18n } from "@/lib/admin-i18n";

export interface MediaGalleryItem {
  key: string;
  domId?: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string;
}
interface MediaGalleryLabels {
  type(number: number): string;
  url(number: number): string;
  alt(number: number): string;
  previous(number: number): string;
  next(number: number): string;
  remove: string;
}

export function MediaGallery({ items, scope, pending, labels, listLabel, highlightedKey = null, highlightNonce = 0, problemKey = null, errors = {}, indexed = false, onUpload, onPatch, onMove, onRemove }: {
  items: readonly MediaGalleryItem[];
  scope: string;
  pending: boolean;
  labels: MediaGalleryLabels;
  listLabel?: string;
  highlightedKey?: string | null;
  highlightNonce?: number;
  problemKey?: string | null;
  errors?: Readonly<Record<string, string>>;
  indexed?: boolean;
  onUpload(key: string, file: File): Promise<void>;
  onPatch(key: string, patch: Partial<Pick<MediaGalleryItem, "type" | "url" | "altText">>): void;
  onMove(key: string, delta: -1 | 1): void;
  onRemove(key: string): void;
}): ReactNode {
  const { t } = useAdminI18n();
  const editorId = useId();
  const [selected, setSelected] = useState<string | null>(highlightedKey);
  const [lastHighlight, setLastHighlight] = useState({ key: highlightedKey, nonce: highlightNonce });
  const [lastCount, setLastCount] = useState(items.length);
  if (lastHighlight.key !== highlightedKey || lastHighlight.nonce !== highlightNonce) {
    setLastHighlight({ key: highlightedKey, nonce: highlightNonce });
    if (highlightedKey) setSelected(highlightedKey);
  }
  if (lastCount !== items.length) {
    setLastCount(items.length);
    const last = items.at(-1);
    if (items.length > lastCount && last && !last.url.trim()) setSelected(last.key);
  }
  const activeIndex = items.findIndex((item) => item.key === selected);
  const active = items[activeIndex];
  const number = activeIndex + 1;
  const move = (index: number, delta: -1 | 1): void => {
    const next = index + delta;
    if (pending || next < 0 || next >= items.length) return;
    if (indexed) {
      const current = activeIndex < 0 ? index : activeIndex;
      const target = current === index ? next : current === next ? index : current;
      setSelected(items[target].key);
    } else if (!active) setSelected(items[index].key);
    onMove(items[index].key, delta);
  };
  const remove = (index: number): void => {
    if (pending) return;
    if (activeIndex === index) setSelected(null);
    else if (indexed && activeIndex > index) setSelected(items[activeIndex - 1].key);
    onRemove(items[index].key);
  };
  const problemField = problemKey?.match(/\.(type|url|altText|sortOrder)$/)?.[1] ?? "url";
  const fieldProblemId = (field: string): string | undefined =>
    active?.key === highlightedKey && problemKey && problemField === field ? `pf-row-${problemKey}` : undefined;
  const invalidItems = items.map((item, index) => ({ item, index, messages: Object.entries(errors).filter(([key]) => key === item.key || key.startsWith(`${item.key}.`)).map(([, message]) => message) })).filter(({ messages }) => messages.length > 0);
  const actionClass = "inline-flex h-6 min-w-0 flex-1 items-center justify-center rounded bg-white/90 px-1 text-[11px] font-semibold text-ink hover:bg-white disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-3 min-w-0" data-media-gallery={scope}>
      <ul aria-label={listLabel ?? t("product_media_gallery_aria", { scope })} className="grid grid-cols-[repeat(auto-fill,minmax(88px,104px))] justify-start gap-2">
        {items.map((item, index) => {
          const expanded = active?.key === item.key;
          return (
            <li key={item.key} id={item.domId === `pf-row-${problemKey}` && expanded ? undefined : item.domId} className={`group relative overflow-hidden rounded-lg bg-background ${item.key === highlightedKey || invalidItems.some(({ item: invalid }) => invalid.key === item.key) ? "ring-2 ring-cta ring-offset-1" : "border border-border"}`}>
              <button type="button" aria-label={t("product_media_edit_card", { scope, number: index + 1 })} aria-expanded={expanded} aria-controls={editorId} onClick={() => setSelected(expanded ? null : item.key)} className="relative block aspect-square w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-cta">
                {item.url.trim() ? item.type === "VIDEO"
                  ? <video src={item.url} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                  : /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={item.url} alt={item.altText} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  : <span className="flex h-full items-center justify-center px-2 text-xs text-ink-muted">{t(item.type === "VIDEO" ? "product_media_empty_video" : "product_media_empty_image")}</span>}
                <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px] text-ink-secondary">{index + 1}</span>
                {item.type === "VIDEO" ? <span className="absolute right-1 top-1 rounded bg-white/90 px-1 text-[10px] text-ink">{t("product_media_type_video")}</span> : null}
              </button>
              <div data-media-actions className={`absolute inset-x-0 bottom-0 flex gap-px bg-gradient-to-t from-black/45 px-px pb-1 pt-5 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 ${expanded ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
                <button type="button" className={actionClass} aria-label={labels.previous(index + 1)} disabled={pending || index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className={actionClass} aria-label={labels.next(index + 1)} disabled={pending || index === items.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className={actionClass} aria-label={labels.remove} disabled={pending} onClick={() => remove(index)}>×</button>
              </div>
            </li>
          );
        })}
      </ul>
      {invalidItems.filter(({ item }) => item.key !== active?.key).map(({ item, index, messages }) => (
        <button type="button" key={item.key} className="mt-2 flex flex-wrap gap-x-2 text-left text-xs text-admin-error hover:underline" onClick={() => setSelected(item.key)}>
          <span>{scope} {index + 1}</span>
          {messages.map((message) => <span key={message}>{message}</span>)}
        </button>
      ))}
      {active ? (
        <div id={editorId} className="mt-3 rounded-xl border border-border bg-background p-3" data-media-editor>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink">{scope} {number}</span>
            <div className="flex gap-3 text-xs font-semibold">
              <button type="button" disabled={pending} onClick={() => remove(activeIndex)} className="text-red-700 disabled:text-ink-muted">{labels.remove}</button>
              <button type="button" aria-label={t("product_media_edit_close")} onClick={() => setSelected(null)} className="text-ink-secondary">×</button>
            </div>
          </div>
          <div data-selected-media-preview className="mb-3 flex h-48 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
            {active.url.trim() ? active.type === "VIDEO"
              ? <video src={active.url} controls playsInline preload="metadata" className="h-full w-full object-contain" />
              : /* eslint-disable-next-line @next/next/no-img-element */
                <img src={active.url} alt={active.altText} referrerPolicy="no-referrer" className="h-full w-full object-contain" />
              : <span className="text-xs text-ink-muted">{t(active.type === "VIDEO" ? "product_media_empty_video" : "product_media_empty_image")}</span>}
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
            <div id={fieldProblemId("type")}>
              <Field label={t("product_media_type_label")} htmlFor={`${editorId}-type`} error={errors[`${active.key}.type`]}>
                <Select id={`${editorId}-type`} aria-label={labels.type(number)} value={active.type} disabled={pending} onChange={(event) => onPatch(active.key, { type: event.target.value as MediaGalleryItem["type"] })}>
                  <option value="IMAGE">{t("product_media_type_image")}</option><option value="VIDEO">{t("product_media_type_video")}</option>
                </Select>
              </Field>
            </div>
            <div id={fieldProblemId("altText")}>
              <Field label={t("product_media_alt_label")} htmlFor={`${editorId}-alt`} error={errors[`${active.key}.altText`]}>
                <TextInput id={`${editorId}-alt`} aria-label={labels.alt(number)} value={active.altText} maxLength={255} autoComplete="off" disabled={pending} onChange={(event) => onPatch(active.key, { altText: event.target.value })} />
              </Field>
            </div>
            <div id={fieldProblemId("url")} className="sm:col-span-2">
              <Field label={t(active.type === "VIDEO" ? "product_media_url_video_label" : "product_media_url_image_label")} htmlFor={`${editorId}-url`} error={errors[`${active.key}.url`]}>
                <ImageUrlInput key={`${active.key}:${active.type}`} id={`${editorId}-url`} ariaLabel={labels.url(number)} kind={active.type === "VIDEO" ? "video" : "image"} value={active.url} disabled={pending} problemFocus={active.key === highlightedKey && problemField === "url"} onUpload={(file) => onUpload(active.key, file)} onChange={(url) => onPatch(active.key, { url })} />
              </Field>
            </div>
            {errors[`${active.key}.sortOrder`] ? <p id={fieldProblemId("sortOrder")} role="alert" className="text-xs text-admin-error sm:col-span-2">{errors[`${active.key}.sortOrder`]}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
