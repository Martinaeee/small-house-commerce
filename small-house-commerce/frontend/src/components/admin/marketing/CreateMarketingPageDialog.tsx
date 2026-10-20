"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { ProductPickerInline, type ProductOption } from "@/components/admin/ProductPicker";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi, type MarketingOwnerOption, type MarketingProductOption } from "@/lib/marketing-api";

const fieldClass = "w-full rounded-lg border border-admin-border px-3 py-2 text-sm";
export function CreateMarketingPageDialog({ productId: presetProductId, owners, onClose }: { productId?: string; owners: MarketingOwnerOption[]; onClose: () => void }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const router = useRouter();
  const [productId, setProductId] = useState(presetProductId ?? "");
  const [preset, setPreset] = useState<{
    id: string;
    product: MarketingProductOption | null;
  } | null>(null);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const manageAll = admin?.permissions.includes("MARKETING_MANAGE_ALL");

  const loadProducts = useCallback(async (search: string): Promise<ProductOption[]> => {
    const result = await marketingApi.productOptions({ search: search || undefined, page: 1, pageSize: 50 });
    return result.items.map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      productCode: item.productCode,
      thumbnailUrl: item.thumbnailUrl,
    }));
  }, []);

  useEffect(() => {
    if (!presetProductId) return;
    let alive = true;
    marketingApi.productOptions({ id: presetProductId, page: 1, pageSize: 1 })
      .then((result) => { if (alive) setPreset({ id: presetProductId, product: result.items[0] ?? null }); })
      .catch(() => { if (alive) setPreset({ id: presetProductId, product: null }); });
    return () => { alive = false; };
  }, [presetProductId]);

  const presetProduct =
    preset && preset.id === presetProductId ? preset.product : null;
  const presetResolved = !presetProductId || Boolean(preset);

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
    <ProductPickerInline
      label={t("link_builder_product")}
      scope="marketing-page-product"
      value={productId}
      onChange={(next) => setProductId(next ?? "")}
      loadProducts={loadProducts}
      currentOption={presetProduct}
      loading={!presetResolved}
      disabled={busy || Boolean(presetProductId)}
      searchLabel={t("marketing_product_search")}
    />
    {manageAll && <label className="block space-y-1 text-sm">{t("marketing_owner")}<select className={fieldClass} disabled={busy} value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}><option value="">{admin?.name}</option>{owners.filter((owner) => owner.status === "ACTIVE" && owner.userStatus === "ACTIVE" && owner.userId !== admin?.id).map((owner) => <option key={owner.userId} value={owner.userId}>{owner.displayName} · {owner.aid}</option>)}</select></label>}
    <label className="block space-y-1 text-sm">{t("marketing_internal_name")}<input className={fieldClass} required maxLength={120} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <p className="text-xs text-admin-muted">{t("marketing_draft_create_hint")}</p>
    <div className="flex justify-end gap-2"><button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" disabled={busy} onClick={onClose}>{t("common_cancel")}</button><button type="submit" className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !productId || !name.trim()}>{t("marketing_draft_create")}</button></div>
  </form></Dialog>;
}
