"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { canManageMarketingPage, marketingApi, type CampaignLinkRow, type MarketingLinkContext, type MarketingSourceType } from "@/lib/marketing-api";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm disabled:bg-slate-50";
const sources: MarketingSourceType[] = ["META_AD", "FB_POST", "ORGANIC", "DIRECT", "EMAIL", "OTHER"];
const metadata = [
  ["campaignId", "link_builder_campaign_id", 64], ["adsetId", "link_builder_adset_id", 64], ["adId", "link_builder_ad_id", 64],
  ["utmSource", "link_builder_utm_source", 120], ["utmMedium", "link_builder_utm_medium", 120], ["utmCampaign", "link_builder_utm_campaign", 120],
  ["utmContent", "marketing_utm_content", 120], ["utmTerm", "marketing_utm_term", 120],
] as const satisfies readonly (readonly [string, TKey, number])[];

export function CreateCampaignLinkDialog({ productId: initialProductId, landingPageId: initialPageId, copyFrom, onClose, onSaved }: {
  productId?: string; landingPageId?: string; copyFrom?: CampaignLinkRow; onClose: () => void; onSaved: (link: CampaignLinkRow) => void;
}) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [context, setContext] = useState<MarketingLinkContext | null>(null);
  const [productId, setProductId] = useState(initialProductId ?? copyFrom?.productId ?? "");
  const [landingPageId, setLandingPageId] = useState(initialPageId ?? copyFrom?.landingPageId ?? "");
  const [variantId, setVariantId] = useState(copyFrom?.variantId ?? "");
  const [name, setName] = useState(copyFrom ? `${copyFrom.name.slice(0, 115)} copy` : "");
  const [sourceType, setSourceType] = useState<MarketingSourceType>(copyFrom?.sourceType ?? "META_AD");
  const [fields, setFields] = useState<Record<string, string>>(Object.fromEntries(metadata.map(([key]) => [key, copyFrom?.[key] ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);

  useEffect(() => {
    let alive = true;
    marketingApi.linkContext().then((value) => { if (alive) setContext(value); }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, []);

  const product = context?.products.find((item) => item.id === productId);
  const pages = product?.landingPages.filter((page) => page.ownerUserId && canManageMarketingPage(admin, page.ownerUserId) && (!copyFrom || page.ownerUserId === copyFrom.ownerUserId)) ?? [];
  const page = pages.find((item) => item.id === landingPageId);
  const unavailable = Boolean(context && (!product || (landingPageId && !page)));

  async function save() {
    if (!product || (landingPageId && !page) || !name.trim() || operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    try {
      const input = { productId, landingPageId: landingPageId || null, variantId: variantId || null, name: name.trim(), sourceType, ...Object.fromEntries(metadata.map(([key]) => [key, fields[key]?.trim() || null])) };
      const link = copyFrom ? await marketingApi.cloneLink(copyFrom.id, input) : await marketingApi.createLink(input);
      onSaved(link);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setBusy(false); }
  }

  return <Dialog open initialFocus="first" onClose={() => { if (!operation.current) onClose(); }} title={t(copyFrom ? "marketing_link_clone" : "marketing_link_create")}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!context && !error && <p className="text-sm text-admin-muted">{t("common_loading")}</p>}
      {unavailable && <p role="alert" className="text-sm text-amber-800">{t("marketing_target_unavailable")}</p>}
      <fieldset disabled={busy || !context} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">{t("link_builder_product")}<select required className={fieldClass} value={productId} disabled={Boolean(initialProductId)} onChange={(event) => { setProductId(event.target.value); setLandingPageId(""); setVariantId(""); }}>
          <option value="">{t("marketing_choose_product")}</option>
          {context?.products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.productCode ?? item.slug}</option>)}
        </select></label>
        <label className="space-y-1 text-sm">{t("link_builder_landing_page")}<select className={fieldClass} value={landingPageId} disabled={Boolean(initialPageId)} onChange={(event) => setLandingPageId(event.target.value)}>
          <option value="">{t("link_builder_no_landing_page")}</option>
          {pages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <label className="space-y-1 text-sm">{t("link_builder_variant")}<select className={fieldClass} value={variantId} onChange={(event) => setVariantId(event.target.value)}>
          <option value="">{t("link_builder_no_variant")}</option>{product?.variants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <div className="rounded-lg bg-slate-50 p-3 text-sm sm:col-span-2"><p className="text-xs text-admin-muted">{t("link_builder_aid")}</p><p className="mt-1 font-medium">{copyFrom ? `${copyFrom.ownerName} · ${copyFrom.aid}` : page ? `${page.ownerName} · ${page.aid}` : admin?.name}</p><p className="mt-1 text-xs text-admin-muted">{t(copyFrom ? "marketing_owner_copy" : "marketing_owner_automatic")}</p></div>
        {page?.effectiveStatus === "SCHEDULED" && <p className="text-xs text-amber-800 sm:col-span-2">{t("marketing_link_scheduled")}</p>}
        <label className="space-y-1 text-sm">{t("marketing_internal_name")}<input required maxLength={120} className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="space-y-1 text-sm">{t("marketing_source_type")}<select className={fieldClass} value={sourceType} onChange={(event) => setSourceType(event.target.value as MarketingSourceType)}>{sources.map((source) => <option key={source} value={source}>{t(`marketing_source_${source}`)}</option>)}</select></label>
        {metadata.map(([key, label, maxLength]) => <label key={key} className="space-y-1 text-sm">{t(label)}<input className={fieldClass} maxLength={maxLength} value={fields[key] ?? ""} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      </fieldset>
      <p className="text-xs text-admin-muted">{t("marketing_link_immutable")}</p>
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex justify-end gap-2 border-t border-admin-border bg-card px-6 pb-6 pt-4"><button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" disabled={busy} onClick={onClose}>{t("common_cancel")}</button><button type="submit" className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !context || unavailable || !name.trim()}>{t("marketing_link_save")}</button></div>
    </form>
  </Dialog>;
}
