"use client";

import Image from "next/image";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePuck } from "@puckeditor/core";
import type { Product } from "@/lib/api";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi } from "@/lib/marketing-api";
import type { LandingMedia } from "@/lib/marketing-content";
import { Dialog } from "@/components/admin/Dialog";
import { MediaAddRow } from "@/components/admin/product-form/MediaAddRow";
import { MediaGallery } from "@/components/admin/product-form/MediaGallery";
import type { MediaBatchUpload } from "@/components/admin/product-form/useMediaBatchUpload";

export const MarketingMediaContext = createContext<{
  pageId: string;
  product: Product | null;
  batch: MediaBatchUpload;
  registerTarget: (key: string, available: () => boolean) => () => void;
} | null>(null);

const binding = (item: LandingMedia) => item.variantId ? `VARIANT:${item.variantId}` : item.optionValueId ? `VALUE:${item.optionValueId}` : "SHARED";
const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-2 py-2 text-sm";

export function MarketingMediaField({ value, onChange, readOnly }: { value: LandingMedia[]; onChange: (media: LandingMedia[]) => void; readOnly?: boolean }) {
  const context = useContext(MarketingMediaContext)!;
  const { t } = useAdminI18n();
  const { selectedItem, getItemById } = usePuck();
  const blockId = selectedItem!.props.id;
  const { pageId, product, batch, registerTarget } = context;
  const latest = useRef(value);
  const [choosing, setChoosing] = useState(false);
  const [source, setSource] = useState<LandingMedia[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = Boolean(readOnly || batch.uploading);
  useEffect(() => { latest.current = value; }, [value]);
  useEffect(() => registerTarget(blockId, () => Boolean(getItemById(blockId))), [blockId, getItemById, registerTarget]);
  useEffect(() => {
    if (!choosing) return;
    let alive = true;
    marketingApi.source(pageId).then(result => {
      if (alive) setSource(result.content.blocks.flatMap(block => block.type === "gallery" || block.type === "detail" ? block.props.media : []));
    }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [pageId, choosing]);

  const scopes = [
    { value: "SHARED", label: t("marketing_media_shared") },
    ...(product?.options.flatMap(option => option.values.map(item => ({ value: `VALUE:${item.id}`, label: `${option.name} · ${item.label}` }))) ?? []),
    ...(product?.variants.map(item => ({ value: `VARIANT:${item.id}`, label: item.name })) ?? []),
  ];
  const scopeLabel = (item: LandingMedia) => scopes.find(scope => scope.value === binding(item))?.label ?? t("marketing_media_unavailable", { id: item.variantId ?? item.optionValueId ?? "" });
  function apply(media: LandingMedia[]) { latest.current = media; onChange(media); }
  function patch(index: number, change: Partial<LandingMedia>) { apply(latest.current.map((item, position) => position === index ? { ...item, ...change } : item)); }

  return <div className="min-w-0 space-y-3">
    <button type="button" className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm disabled:opacity-40" disabled={pending} onClick={() => { setSource(null); setSelected([]); setError(null); setChoosing(true); }}>{t("marketing_media_choose_source")}</button>
    <MediaAddRow disabled={pending} batchUpload={batch} targetKey={blockId} onAddMedia={item => apply([...latest.current, { ...item, altText: null, optionValueId: null, variantId: null }])} />
    <MediaGallery scope={t("marketing_field_media")} indexed pending={pending} items={value.map((item, index) => {
      const current = binding(item);
      const available = scopes.some(scope => scope.value === current);
      return { key: String(index), url: item.url, type: item.type, altText: item.altText ?? "", scopeLabel: available ? scopeLabel(item) : undefined };
    })} labels={{
      type: number => t("marketing_media_format", { number }), url: number => t("marketing_media_url", { number }), alt: number => t("marketing_media_alt", { number }),
      previous: number => t("marketing_media_previous", { number }), next: number => t("marketing_media_next", { number }), remove: t("common_delete"),
    }} onPatch={(key, change) => patch(Number(key), change)} onRemove={key => apply(latest.current.filter((_, index) => String(index) !== key))} onMove={(key, delta) => {
      const next = [...latest.current]; const index = Number(key); [next[index], next[index + delta]] = [next[index + delta], next[index]]; apply(next);
    }} onReorder={(from, to) => {
      const next = [...latest.current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); apply(next);
    }} onUpload={(key, file) => batch.upload([file], { key: blockId, operation: "REPLACE", kind: latest.current[Number(key)].type === "VIDEO" ? "video" : "image", onAddMedia: item => patch(Number(key), item) })} />
    {value.length > 0 && <details className="rounded-lg border border-admin-border p-2" open>
      <summary className="cursor-pointer text-sm font-medium">{t("marketing_media_bindings")}</summary>
      <div className="mt-2 space-y-2">{value.map((item, index) => {
        const current = binding(item); const unavailable = !scopes.some(scope => scope.value === current);
        return <label key={index} className="block space-y-1 text-xs">{t("marketing_media_scope", { number: index + 1 })}<select className={fieldClass} value={current} disabled={pending} onChange={event => {
          const next = event.target.value;
          patch(index, { optionValueId: next.startsWith("VALUE:") ? next.slice(6) : null, variantId: next.startsWith("VARIANT:") ? next.slice(8) : null });
        }}>{unavailable && <option value={current}>{scopeLabel(item)}</option>}{scopes.map(scope => <option key={scope.value} value={scope.value}>{scope.label}</option>)}</select></label>;
      })}</div>
    </details>}
    {choosing && <Dialog open initialFocus="first" title={t("marketing_media_source")} onClose={() => setChoosing(false)}>
      <div className="min-w-0 space-y-3">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!source && !error && <p>{t("common_loading")}</p>}
        {source?.length === 0 && <p className="text-sm text-admin-muted">{t("marketing_media_source_empty")}</p>}
        <div className="grid gap-2 sm:grid-cols-2">{source?.map((item, index) => <label key={index} className="flex min-w-0 items-center gap-3 rounded-lg border border-admin-border p-2 text-sm">
          <input type="checkbox" disabled={pending} checked={selected.includes(index)} onChange={event => setSelected(previous => event.target.checked ? [...previous, index] : previous.filter(value => value !== index))} />
          {item.type === "IMAGE" && <Image unoptimized src={item.url} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded object-cover" />}
          <span className="min-w-0"><span className="block break-all">{item.altText || item.url.split("/").at(-1)}</span><span className="block text-xs text-admin-muted">{t(item.type === "VIDEO" ? "marketing_format_video" : "marketing_format_image")} · {scopeLabel(item)}</span></span>
        </label>)}</div>
        <button type="button" className="rounded-lg bg-cta px-3 py-2 text-sm text-white disabled:opacity-40" disabled={pending || !source || selected.length === 0} onClick={() => { apply([...latest.current, ...selected.map(index => ({ ...source![index] }))]); setChoosing(false); }}>{t("marketing_media_add_selected")}</button>
      </div>
    </Dialog>}
  </div>;
}
