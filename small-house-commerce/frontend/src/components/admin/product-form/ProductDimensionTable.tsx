"use client";

import { Fragment, useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ProductFormValue } from "../ProductForm";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  applyProductDimensionImport, applyProductDimensionPatch, buildProductDimensionTargets,
  dimensionDraftFingerprint, dimensionTargetSource, type DimensionPatch, type DimensionTarget,
} from "@/lib/admin-dimension-import";
import { PRODUCT_DIMENSION_FIELDS } from "@/lib/admin-physical-specs";
import { ProductDimensionImportDialog, dimensionButtonClass, dimensionInputClass } from "./ProductDimensionImportDialog";

const AXIS_LABELS = { productWidth: "dimension_length", productDepth: "dimension_width", productHeight: "dimension_height" } as const;
const DEFAULT_KEYS = { productWidth: "width", productDepth: "depth", productHeight: "height" } as const;

function DimensionRowEditor({ target, value, disabled, onDone, onCancel, onParse }: {
  target: DimensionTarget; value: ProductFormValue; disabled: boolean;
  onDone: (patch: DimensionPatch) => void; onCancel: () => void; onParse: () => void;
}) {
  const { t } = useAdminI18n();
  const [fields, setFields] = useState(() => Object.fromEntries(PRODUCT_DIMENSION_FIELDS.map(field => [field, target.values[field] === null ? "" : String(target.values[field])])));
  const [touched, setTouched] = useState<string[]>([]);
  const invalid = touched.some(field => fields[field].trim() !== "" && (!Number.isFinite(Number(fields[field])) || Number(fields[field]) < 0));
  return <fieldset disabled={disabled} className="space-y-3 bg-background p-4">
    <p className="text-sm font-medium">{t("dimension_edit_scope", { count: target.members.length })}</p>
    <p className="break-words text-sm">{target.members.map(member => `${member.name} · ${member.skuCode}`).join(" / ")}</p>
    {target.mixed.length > 0 ? <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      {target.members.map(member => <p key={member.key}>{member.name}: {PRODUCT_DIMENSION_FIELDS.map(field => `${t(AXIS_LABELS[field])} ${member.values[field] ?? t("dimension_source_inherited")}`).join(" · ")}</p>)}
    </div> : null}
    <div className="grid gap-3 sm:grid-cols-3">{PRODUCT_DIMENSION_FIELDS.map(field => <label key={field} className="flex min-w-0 flex-col gap-1 text-sm font-medium">
      {t(AXIS_LABELS[field])}
      <input aria-label={`${target.label} ${t(AXIS_LABELS[field])}`} className={dimensionInputClass} inputMode="decimal" autoComplete="off" value={fields[field]}
        placeholder={target.mixed.includes(field) ? t("dimension_source_pending") : value[DEFAULT_KEYS[field]] || "—"}
        onChange={event => { setFields(current => ({ ...current, [field]: event.target.value })); setTouched(current => current.includes(field) ? current : [...current, field]); }} />
    </label>)}</div>
    {invalid ? <p role="alert" className="text-sm text-red-700">{t("dimension_issue_values")}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={dimensionButtonClass} disabled={disabled || invalid || touched.length === 0} onClick={() => onDone(Object.fromEntries(touched.map(field => [field, fields[field].trim() === "" ? null : Number(fields[field])]))) }>{t("dimension_done")}</button>
      <button type="button" className={dimensionButtonClass} onClick={onCancel}>{t("dimension_cancel_edit")}</button>
      <button type="button" className={dimensionButtonClass} onClick={onParse}>{t("dimension_parse")}</button>
    </div>
  </fieldset>;
}

export function ProductDimensionTable({ value, onChange, disabled = false, onPreview }: {
  value: ProductFormValue; onChange: Dispatch<SetStateAction<ProductFormValue>>; disabled?: boolean; onPreview?: (memberKey?: string) => void;
}) {
  const { t } = useAdminI18n();
  const targets = buildProductDimensionTargets(value);
  const editable = targets.filter(target => target.editable);
  const unavailable = targets.filter(target => !target.editable);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [reset, setReset] = useState<{ key: string; fingerprint: string } | null>(null);
  const [importKeys, setImportKeys] = useState<{ keys?: string[] } | null>(null);
  const closeImport = useCallback(() => setImportKeys(null), [setImportKeys]);
  const activeSelected = selected.filter(key => editable.some(target => target.key === key));
  const effective = (target: DimensionTarget, field: typeof PRODUCT_DIMENSION_FIELDS[number]) => target.mixed.includes(field) ? null : target.values[field] ?? (value[DEFAULT_KEYS[field]].trim() === "" ? null : Number(value[DEFAULT_KEYS[field]]));
  const equalStyles = editable.filter(target => target.mixed.length === 0 && PRODUCT_DIMENSION_FIELDS.every(field => effective(target, field) !== null && Number.isFinite(effective(target, field))))
    .some((target, index, rows) => rows.slice(index + 1).some(other => other.label !== target.label && PRODUCT_DIMENSION_FIELDS.every(field => Object.is(effective(target, field), effective(other, field)))));

  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={dimensionButtonClass} disabled={disabled || editable.length === 0} onClick={() => setImportKeys({})}>{t("dimension_batch")}</button>
      <button type="button" className={dimensionButtonClass} disabled={disabled || activeSelected.length === 0} onClick={() => setImportKeys({ keys: activeSelected })}>{t("dimension_apply")}</button>
      {onPreview ? <button type="button" className={dimensionButtonClass} onClick={() => onPreview(editable.find(target => activeSelected.includes(target.key))?.members[0]?.key)}>{t("dimension_preview")}</button> : null}
      <details className="relative ml-auto text-sm">
        <summary aria-label={t("dimension_help")} className="flex min-h-10 min-w-10 cursor-pointer list-none items-center justify-center rounded-full border border-border font-semibold">?</summary>
        <p className="absolute right-0 z-10 mt-2 w-64 max-w-[75vw] rounded-lg border border-border bg-card p-3 text-sm shadow-lg">{t("dimension_help_body")}</p>
      </details>
    </div>
    {editable.length ? <div className="overflow-x-auto rounded-lg border border-border">
      <table aria-label={t("dimension_table")} className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-background"><tr>
          <th className="w-10 px-3 py-3"><input type="checkbox" aria-label={t("dimension_select", { name: t("dimension_table") })} checked={activeSelected.length === editable.length} disabled={disabled} onChange={event => setSelected(event.target.checked ? editable.map(target => target.key) : [])} /></th>
          {["dimension_variant", "dimension_length", "dimension_width", "dimension_height", "dimension_source", "dimension_actions"].map(key => <th key={key} className="px-3 py-3 font-semibold">{t(key as "dimension_variant")}</th>)}
        </tr></thead>
        <tbody>{editable.map(target => {
          const source = dimensionTargetSource(target, value);
          const hasOverrides = target.mixed.length > 0 || PRODUCT_DIMENSION_FIELDS.some(field => target.values[field] !== null);
          return <Fragment key={target.key}>
            <tr className="border-t border-border align-top">
              <td className="px-3 py-3"><input type="checkbox" aria-label={t("dimension_select", { name: target.label })} checked={activeSelected.includes(target.key)} disabled={disabled} onChange={event => setSelected(current => event.target.checked ? [...current, target.key] : current.filter(key => key !== target.key))} /></td>
              <td className="max-w-52 px-3 py-3">
                <p className="break-words font-semibold">{target.label}</p>
                {target.members.length > 1 ? <details className="mt-1"><summary className="cursor-pointer text-ink-secondary">{t("dimension_shared", { count: target.members.length })}</summary>
                  <ul className="mt-2 space-y-1">{target.members.map(member => <li key={member.key} className="break-words">{member.name} · {member.skuCode || "—"}</li>)}</ul>
                </details> : <p className="mt-1 break-words text-ink-secondary">{target.members[0].skuCode || "—"}</p>}
              </td>
              {PRODUCT_DIMENSION_FIELDS.map(field => <td key={field} className="px-3 py-3 tabular-nums">{effective(target, field) ?? "—"}</td>)}
              <td className="px-3 py-3"><span className={source === "pending" ? "text-amber-800" : "text-ink-secondary"}>{t(`dimension_source_${source}`)}</span></td>
              <td className="px-3 py-2"><div className="flex flex-wrap gap-2">
                <button type="button" className={dimensionButtonClass} disabled={disabled} onClick={() => { setEditing(target.key); setReset(null); }}>{t(hasOverrides ? "dimension_edit" : "dimension_independent")}</button>
                {hasOverrides ? <button type="button" className={dimensionButtonClass} disabled={disabled} onClick={() => { setReset({ key: target.key, fingerprint: dimensionDraftFingerprint(value) }); setEditing(null); }}>{t("dimension_default")}</button> : null}
              </div></td>
            </tr>
            {editing === target.key ? <tr><td colSpan={7}><DimensionRowEditor key={target.key} target={target} value={value} disabled={disabled}
              onCancel={() => setEditing(null)} onParse={() => setImportKeys({ keys: [target.key] })}
              onDone={patch => { onChange(current => applyProductDimensionPatch(current, [target.key], patch)); setEditing(null); }} /></td></tr> : null}
            {reset?.key === target.key ? <tr><td colSpan={7}><div role="alertdialog" aria-label={t("dimension_default")} className="space-y-3 bg-amber-50 p-4 text-sm text-amber-950">
              <p>{t("dimension_default_warning", { count: target.members.length })}</p>
              <p className="break-words">{target.members.map(member => member.skuCode || member.name).join(", ")}</p>
              {reset.fingerprint !== dimensionDraftFingerprint(value) ? <p role="alert">{t("dimension_stale")}</p> : null}
              <div className="flex flex-wrap gap-2"><button type="button" className={dimensionButtonClass} disabled={disabled || reset.fingerprint !== dimensionDraftFingerprint(value)} onClick={() => {
                onChange(current => dimensionDraftFingerprint(current) === reset.fingerprint ? applyProductDimensionPatch(current, [target.key], { productWidth: null, productDepth: null, productHeight: null }) : current); setReset(null);
              }}>{t("dimension_default_confirm")}</button><button type="button" className={dimensionButtonClass} onClick={() => setReset(null)}>{t("dimension_cancel")}</button></div>
            </div></td></tr> : null}
          </Fragment>;
        })}</tbody>
      </table>
    </div> : <p className="text-sm text-ink-secondary">{t("dimension_empty")}</p>}
    {equalStyles ? <p className="text-sm text-amber-800">{t("dimension_same")}</p> : null}
    {unavailable.length ? <details className="text-sm"><summary className="min-h-10 cursor-pointer py-2 font-medium">{t("dimension_unavailable", { count: unavailable.length })}</summary>
      <ul className="space-y-2">{unavailable.map(target => <li key={target.key} className="break-words">{target.label} · {target.members.map(row => row.skuCode).join(", ")} · {t(target.bundle ? "physical_group_bundle_dimensions" : "dimension_readonly")}</li>)}</ul>
    </details> : null}
    {importKeys ? <ProductDimensionImportDialog value={value} targetKeys={importKeys.keys} disabled={disabled} onClose={closeImport} onApply={(plan, ids) => {
      if (dimensionDraftFingerprint(value) !== plan.fingerprint) throw new Error("dimension_issue_stale");
      onChange(current => applyProductDimensionImport(current, plan, ids)); setImportKeys(null); setEditing(null);
    }} /> : null}
  </div>;
}
