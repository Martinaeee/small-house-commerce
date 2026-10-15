"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi, type MarketingOwnerOption, type MarketingProductOption } from "@/lib/marketing-api";

const fieldClass = "w-full rounded-lg border border-admin-border px-3 py-2 text-sm";
export function CreateMarketingPageDialog({ productId: presetProductId, owners, onClose }: { productId?: string; owners: MarketingOwnerOption[]; onClose: () => void }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const router = useRouter();
  const [products, setProducts] = useState<MarketingProductOption[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pickerPage, setPickerPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [productId, setProductId] = useState(presetProductId ?? "");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const manageAll = admin?.permissions.includes("MARKETING_MANAGE_ALL");
  useEffect(() => {
    let alive = true;
    marketingApi.productOptions({ search: query || undefined, page: pickerPage, pageSize: 50 }).then((result) => { if (alive) { setProducts(result.items); setTotal(result.total); setLoading(false); } }).catch((reason: unknown) => { if (alive) { setLoading(false); setError(reason instanceof Error ? reason.message : String(reason)); } });
    return () => { alive = false; };
  }, [query, pickerPage]);
  async function create() {
    if (!productId || !name.trim() || operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    try {
      const page = await marketingApi.createPage(productId, name.trim(), ownerUserId || undefined);
      router.push(`/admin/marketing/${encodeURIComponent(page.id)}/edit`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); operation.current = false; setBusy(false); }
  }
  return <Dialog open initialFocus="first" onClose={() => { if (!operation.current) onClose(); }} title={t("marketing_page_create")}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!presetProductId && <div className="flex gap-2"><input className={fieldClass} aria-label={t("marketing_product_search")} placeholder={t("marketing_product_search")} value={search} onChange={(event) => setSearch(event.target.value)} /><button type="button" className="shrink-0 text-sm underline" onClick={() => { if (query !== search || pickerPage !== 1) setLoading(true); setQuery(search); setPickerPage(1); }}>{t("common_search")}</button></div>}
    <label className="block space-y-1 text-sm">{t("link_builder_product")}<select className={fieldClass} required value={productId} disabled={busy || loading || Boolean(presetProductId)} onChange={(event) => setProductId(event.target.value)}><option value="">{t("marketing_choose_product")}</option>{presetProductId && !products.some((product) => product.id === presetProductId) && <option value={presetProductId}>{t("marketing_current_product")}</option>}{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.productCode ?? product.slug}</option>)}</select></label>
    {!presetProductId && total > 50 && <div className="flex justify-between text-xs"><button type="button" disabled={pickerPage === 1 || loading} onClick={() => { setLoading(true); setPickerPage((value) => value - 1); }}>{t("marketing_previous")}</button><span>{pickerPage}</span><button type="button" disabled={pickerPage * 50 >= total || loading} onClick={() => { setLoading(true); setPickerPage((value) => value + 1); }}>{t("marketing_next")}</button></div>}
    {manageAll && <label className="block space-y-1 text-sm">{t("marketing_owner")}<select className={fieldClass} disabled={busy} value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}><option value="">{admin?.name}</option>{owners.filter((owner) => owner.status === "ACTIVE" && owner.userStatus === "ACTIVE" && owner.userId !== admin?.id).map((owner) => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}</select></label>}
    <label className="block space-y-1 text-sm">{t("marketing_internal_name")}<input className={fieldClass} required maxLength={120} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <p className="text-xs text-admin-muted">{t("marketing_draft_create_hint")}</p>
    <div className="flex justify-end gap-2"><button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" disabled={busy} onClick={onClose}>{t("common_cancel")}</button><button type="submit" className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || loading || !productId || !name.trim()}>{t("marketing_draft_create")}</button></div>
  </form></Dialog>;
}
