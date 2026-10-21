"use client";

import { useEffect, useId, useRef, useState } from "react";
import { adminApi, type AdminBundleDefinition, type AdminBundleSkuCandidate } from "@/lib/admin-api";
import { bundleDraftAvailability, bundleDraftToInput, type AdminBundleDraft, type AdminBundleEditorDraft } from "@/lib/admin-bundle";
import { useAdminI18n } from "@/lib/admin-i18n";
import { inputClsCompact } from "./Field";

function draftComponents(definition: AdminBundleDefinition): AdminBundleDraft[] {
  return definition.components.map((row) => ({ ...row, quantity: String(row.quantity) }));
}

export function BundleComponentsEditor({ productId, skuId, draft, definition, expectedVersion, onDefinitionChange, onChange, disabled = false, onSavingChange }: {
  definition?: AdminBundleDefinition;
  expectedVersion?: number;
  onDefinitionChange?: (definition: AdminBundleDefinition) => void;
  productId: string;
  skuId: string;
  draft?: AdminBundleEditorDraft;
  onChange: (draft: AdminBundleEditorDraft | undefined) => void;
  disabled?: boolean;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { t } = useAdminI18n();
  const queryId = useId();
  const [loaded, setLoaded] = useState<AdminBundleDefinition | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<AdminBundleSkuCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);

  useEffect(() => {
    let active = true;
    void adminApi.getBundleComponents(productId, skuId).then((value) => {
      if (active) setLoaded(current => !current || value.version >= current.version ? value : current);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : t("bundle_invalid"));
    });
    return () => { active = false; };
  }, [productId, skuId, expectedVersion, t]);

  const newestDefinition = definition && (!loaded || definition.version > loaded.version) ? definition : loaded;
  const effectiveDefinition = newestDefinition && newestDefinition.version >= (expectedVersion ?? 0) ? newestDefinition : null;
  const components = draft?.components ?? (effectiveDefinition ? draftComponents(effectiveDefinition) : []);
  const version = draft?.version ?? effectiveDefinition?.version;
  const update = (next: AdminBundleDraft[]): void => {
    if (version === undefined) return;
    onChange({ version, components: next });
    setNotice(false);
  };
  let valid = true;
  try { bundleDraftToInput(components); } catch { valid = false; }
  const blocked = disabled || saving;

  const reload = async (): Promise<void> => {
    setError(null);
    try {
      const result = await adminApi.getBundleComponents(productId, skuId);
      setLoaded(result);
      onDefinitionChange?.(result);
      onChange(undefined);
      setNotice(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("bundle_invalid"));
    }
  };
  const search = async (): Promise<void> => {
    const sequence = ++searchSequence.current;
    setSearching(true);
    setError(null);
    try {
      const result = await adminApi.searchBundleSkus(query.trim());
      if (sequence === searchSequence.current) setCandidates(result.filter((row) => row.id !== skuId));
    } catch (err) {
      if (sequence === searchSequence.current) setError(err instanceof Error ? err.message : t("bundle_invalid"));
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  };
  const save = async (): Promise<void> => {
    if (version === undefined || !valid || blocked) return;
    setSaving(true);
    onSavingChange?.(true);
    setError(null);
    try {
      const result = await adminApi.setBundleComponents(productId, skuId, { expectedVersion: version, components: bundleDraftToInput(components) });
      setLoaded(result);
      onDefinitionChange?.(result);
      onChange(undefined);
      setNotice(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("bundle_invalid"));
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  const move = (index: number, delta: number): void => {
    const next = [...components];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    update(next);
  };

  return (
    <div className="mt-3 min-w-0 rounded-lg border border-border bg-background p-3 text-left text-xs">
      <p className="text-ink-muted">{t("bundle_hint")}</p>
      {error ? <p role="alert" className="mt-2 text-admin-error">{error}</p> : null}
      {notice ? <p role="status" className="mt-2 text-cta">{t("bundle_saved")}</p> : null}
      {version === undefined && !error ? <p>{t("bundle_loading")}</p> : null}
      <button type="button" className="mt-2 underline" onClick={() => void reload()} disabled={blocked}>{t("bundle_reload")}</button>
      {version !== undefined ? <>
        <p className="mt-3 font-semibold">{t("bundle_availability", { count: bundleDraftAvailability(components) })}</p>
        <ol className="mt-2 space-y-2">
          {components.map((row, index) => <li key={row.componentSkuId} className="rounded border border-border bg-card p-2">
            <p className="font-medium">{row.componentProductName} / {row.componentVariantName}</p>
            <p className="text-ink-muted">{row.componentSkuCode} · {t("bundle_component_availability", { count: row.availableInventory })}</p>
            {row.status !== "ACTIVE" || row.productStatus !== "ACTIVE" || row.isBundle ? <p className="text-admin-error">{t("bundle_unavailable")}</p> : null}
            <div className="mt-1 flex items-center gap-2">
              <input className={`${inputClsCompact} w-20`} inputMode="numeric" aria-label={t("bundle_quantity", { code: row.componentSkuCode })} value={row.quantity} onChange={(event) => update(components.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} disabled={blocked} />
              <button type="button" aria-label={t("bundle_move_up", { code: row.componentSkuCode })} onClick={() => move(index, -1)} disabled={blocked || index === 0}>↑</button>
              <button type="button" aria-label={t("bundle_move_down", { code: row.componentSkuCode })} onClick={() => move(index, 1)} disabled={blocked || index === components.length - 1}>↓</button>
              <button type="button" className="underline" onClick={() => update(components.filter((_, i) => i !== index))} disabled={blocked}>{t("bundle_remove", { code: row.componentSkuCode })}</button>
            </div>
          </li>)}
        </ol>
        <label htmlFor={queryId} className="mt-3 block">{t("bundle_search_label")}</label>
        <div className="mt-1 flex gap-2">
          <input id={queryId} className={inputClsCompact} value={query} maxLength={120} onChange={(event) => { searchSequence.current += 1; setSearching(false); setCandidates([]); setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} disabled={blocked} />
          <button type="button" className="shrink-0 rounded border border-border px-2" disabled={blocked || searching} onClick={() => void search()}>{t("bundle_search")}</button>
        </div>
        {candidates.map((row) => <div key={row.id} className="mt-2 flex items-center justify-between gap-2">
          <span>{row.productName} / {row.variantName} ({row.skuCode})</span>
          <button type="button" className="shrink-0 underline" disabled={blocked || components.length >= 20 || components.some((item) => item.componentSkuId === row.id)} onClick={() => update([...components, { componentSkuId: row.id, quantity: "1", componentSkuCode: row.skuCode, componentProductName: row.productName, componentVariantName: row.variantName, availableInventory: row.availableInventory, status: "ACTIVE", productStatus: "ACTIVE", isBundle: false }])}>{t("bundle_add", { code: row.skuCode })}</button>
        </div>)}
        {!valid ? <p className="mt-2 text-ink-muted">{t("bundle_invalid")}</p> : null}
        <button type="button" className="mt-3 rounded bg-cta px-3 py-2 font-semibold text-white disabled:opacity-50" disabled={blocked || !valid} onClick={() => void save()}>{t("bundle_save")}</button>
      </> : null}
    </div>
  );
}
