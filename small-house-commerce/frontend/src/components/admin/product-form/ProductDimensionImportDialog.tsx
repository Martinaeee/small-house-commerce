"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProductFormValue } from "../ProductForm";
import { useAdminI18n } from "@/lib/admin-i18n";
import { entityRowKey } from "@/lib/admin-product-graph";
import {
  buildProductDimensionTargets, dimensionDraftFingerprint, dimensionImportExceedsLimit, planProductDimensionImport,
  type DimensionColumn, type DimensionConfig, type DimensionImportPlan, type DimensionOrder, type DimensionUnit,
} from "@/lib/admin-dimension-import";

export const dimensionInputClass = "h-10 min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-ink focus:border-primary disabled:opacity-50";
export const dimensionButtonClass = "min-h-10 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-ink hover:border-primary disabled:opacity-50";
const ORDERS = ["LWH", "LHW", "WLH", "WHL", "HLW", "HWL"] as const;
const COLUMNS = ["ignore", "sku", "variant", "dimensions", "length", "width", "height", "unit"] as const;

export function DimensionConventionControls({ order, unit, onChange, disabled = false }: {
  order: DimensionOrder; unit: DimensionUnit; onChange: (change: Pick<DimensionConfig, "order" | "unit">) => void; disabled?: boolean;
}) {
  const { t } = useAdminI18n();
  const id = useId();
  return <div className="flex flex-wrap gap-3">
    <label className="flex min-w-0 flex-col gap-1 text-sm font-medium" htmlFor={`${id}-order`}>
      {t("dimension_order")}
      <select id={`${id}-order`} className={dimensionInputClass} value={order} disabled={disabled} onChange={event => onChange({ order: event.target.value as DimensionOrder, unit })}>
        <option value="">{t("dimension_order_choose")}</option>
        {ORDERS.map(value => <option key={value} value={value}>{t(`dimension_order_${value}`)}</option>)}
      </select>
    </label>
    <label className="flex min-w-0 flex-col gap-1 text-sm font-medium" htmlFor={`${id}-unit`}>
      {t("dimension_unit")}
      <select id={`${id}-unit`} className={dimensionInputClass} value={unit} disabled={disabled} onChange={event => onChange({ order, unit: event.target.value as DimensionUnit })}>
        <option value="">{t("dimension_unit_choose")}</option>
        {["cm", "mm", "m", "in", "ft"].map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
  </div>;
}

function initialColumns(firstLine: string, optionRoles: Record<string, DimensionColumn>): { columns: DimensionColumn[]; header: boolean } {
  const cells = firstLine.split("\t");
  const roles: Record<string, DimensionColumn> = { sku: "sku", "sku 编码": "sku", "sku编码": "sku", "变体": "variant", "变体组合": "variant", "款式": "variant", "尺寸": "dimensions", "长": "length", l: "length", "宽": "width", w: "width", "高": "height", h: "height", "单位": "unit", unit: "unit" };
  const mapped = cells.map(cell => {
    const label = cell.trim().replace(/\s*[（(](?:cm|mm|m|in|ft)[）)]\s*$/i, "").toLowerCase();
    return Object.hasOwn(optionRoles, label) ? optionRoles[label] : Object.hasOwn(roles, label) ? roles[label] : "ignore";
  });
  const header = mapped.some(role => role === "sku" || role === "variant" || role.startsWith("option:"));
  return { header, columns: header ? mapped : cells.length <= 2 ? ["sku", "dimensions"] : cells.map((_, index) => index === 0 ? "sku" : "ignore") };
}

export function ProductDimensionImportDialog({ value, targetKeys, onApply, onClose, disabled = false }: {
  value: ProductFormValue; targetKeys?: string[]; disabled?: boolean;
  onApply: (plan: DimensionImportPlan, selectedIds: string[]) => void; onClose: () => void;
}) {
  const { t } = useAdminI18n();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [config, setConfig] = useState<DimensionConfig>({ order: "", unit: "", columns: ["sku", "dimensions"], hasHeader: false });
  const [plan, setPlan] = useState<DimensionImportPlan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mappingEdited, setMappingEdited] = useState(false);
  const options = value.graphTyped && value.graph ? value.graph.options.filter(option => option.isActive) : [];
  const optionRoles = Object.fromEntries(options.filter(option => options.filter(other => other.name.trim().toLowerCase() === option.name.trim().toLowerCase()).length === 1)
    .map(option => [option.name.trim().toLowerCase(), `option:${entityRowKey(option)}` as DimensionColumn]));
  const targets = buildProductDimensionTargets(value);
  const oversized = dimensionImportExceedsLimit(text);
  const stale = plan !== null && plan.fingerprint !== dimensionDraftFingerprint(value);
  const selectedRows = plan?.rows.filter(row => selected.includes(row.id)) ?? [];
  const affected = targets.filter(target => selectedRows.some(row => row.targetKey === target.key));
  const invalid = selectedRows.length === 0 || selectedRows.some(row => row.issue !== null);
  const changeConfig = (change: Partial<DimensionConfig>) => {
    setConfig(current => ({ ...current, ...change })); setPlan(null); setAcknowledged(false); setError(null);
  };

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return () => { document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);

  const parse = () => {
    const next = planProductDimensionImport(value, text, { ...config, targetKeys });
    setPlan(next); setSelected(next.rows.map(row => row.id)); setAcknowledged(false); setError(null);
  };
  const apply = () => {
    if (!plan || stale || invalid || !acknowledged || disabled) return;
    try { onApply(plan, selected); }
    catch { setError(t("dimension_stale")); }
  };

  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="max-h-[90dvh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card p-4 text-ink shadow-xl sm:p-6" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="text-lg font-semibold">{t(targetKeys ? "dimension_parse" : "dimension_batch_title")}</h3>
        <button type="button" className={dimensionButtonClass} onClick={onClose}>{t("dimension_cancel")}</button>
      </div>
      <label className="flex flex-col gap-2 text-sm font-medium" htmlFor={`${id}-text`}>
        {t(targetKeys ? "product_dimensions_assist_label" : "dimension_paste")}
        <textarea id={`${id}-text`} className={`${dimensionInputClass} min-h-28 w-full py-2 font-mono`} value={text} disabled={disabled}
          placeholder={targetKeys ? "120 × 60 × 75 cm" : "SKU-001\t120 × 60 × 75 cm\nSKU-002\t800 × 400 × 900 mm"}
          onChange={event => {
            const next = event.target.value;
            setText(next); setPlan(null); setAcknowledged(false); setError(null);
            if (!targetKeys && !dimensionImportExceedsLimit(next)) {
              const detected = initialColumns(next.split(/\r?\n/)[0], optionRoles);
              setConfig(current => mappingEdited && current.columns?.length === detected.columns.length ? current : { ...current, columns: detected.columns, hasHeader: detected.header });
            }
          }} />
      </label>
      {!targetKeys ? <div className="my-3 space-y-3">
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={config.hasHeader} disabled={disabled} onChange={event => { setMappingEdited(true); changeConfig({ hasHeader: event.target.checked }); }} />{t("dimension_header")}</label>
        <div className="flex flex-wrap gap-3">{config.columns?.map((column, index) => <label key={index} className="flex min-w-0 flex-col gap-1 text-sm">
          {t("dimension_column", { number: index + 1 })}{config.hasHeader ? ` · ${text.split(/\r?\n/)[0].split("\t")[index] ?? ""}` : ""}
          <select aria-label={t("dimension_column", { number: index + 1 })} className={dimensionInputClass} disabled={disabled} value={column} onChange={event => { setMappingEdited(true); changeConfig({ columns: config.columns!.map((role, i) => i === index ? event.target.value as DimensionColumn : role) }); }}>
            {COLUMNS.map(role => <option key={role} value={role}>{t(`dimension_column_${role}`)}</option>)}
            {options.map(option => <option key={entityRowKey(option)} value={`option:${entityRowKey(option)}`}>{option.name}</option>)}
          </select>
        </label>)}</div>
      </div> : null}
      <div className="my-4"><DimensionConventionControls order={config.order} unit={config.unit} onChange={changeConfig} disabled={disabled} /></div>
      {oversized ? <p role="alert" className="mb-3 text-sm text-red-700">{t("dimension_issue_size")}</p> : null}
      <button type="button" className={dimensionButtonClass} disabled={disabled || oversized || !text.trim()} onClick={parse}>{t("dimension_parse")}</button>
      {plan ? <div className="mt-4 space-y-3">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[740px] text-left text-sm">
            <thead className="bg-background"><tr>{["", t("dimension_variant"), t("dimension_original"), t("dimension_parsed"), t("dimension_units"), t("dimension_status")].map((heading, index) => <th key={index} className="px-3 py-3 font-semibold">{heading}</th>)}</tr></thead>
            <tbody>{plan.rows.map(row => <tr key={row.id} className="border-t border-border align-top">
              <td className="px-3 py-3"><input type="checkbox" aria-label={t("dimension_select", { name: `${row.line}: ${row.identifier}` })} checked={selected.includes(row.id)} disabled={disabled} onChange={event => { setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id)); setAcknowledged(false); }} /></td>
              <td className="max-w-48 break-words px-3 py-3">{row.identifier || "—"}</td>
              <td className="max-w-56 whitespace-pre-wrap break-words px-3 py-3">{row.original}</td>
              <td className="px-3 py-3">{row.dimensions ? `${row.dimensions.productWidth} × ${row.dimensions.productDepth} × ${row.dimensions.productHeight} cm` : "—"}</td>
              <td className="px-3 py-3">{row.inputUnit ? `${row.inputUnit} → cm` : "—"}</td>
              <td className={`max-w-56 px-3 py-3 ${row.issue ? "text-red-700" : "text-ink"}`}>{row.issue ? t(row.issue) : t("dimension_ready")}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-sm">{t("dimension_selection", { selected: selected.length, excluded: plan.rows.length - selected.length })}</p>
        {affected.map(target => <div key={target.key} className="rounded-lg bg-background p-3 text-sm">
          <p className="font-semibold">{target.label} · {t("dimension_affected", { count: target.members.length, skus: target.members.map(row => row.skuCode || row.name).join(", ") })}</p>
          {target.members.map(member => <p key={member.key} className="mt-1 break-words text-ink-secondary">{member.name}: {Object.values(member.values).map(value => value ?? t("dimension_source_inherited")).join(" × ")} → {(() => { const parsed = selectedRows.find(row => row.targetKey === target.key)?.dimensions; return parsed ? `${parsed.productWidth} × ${parsed.productDepth} × ${parsed.productHeight} cm` : "—"; })()}</p>)}
        </div>)}
        <p className="text-sm text-ink-secondary">{t("dimension_overwrite")}</p>
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={event => setAcknowledged(event.target.checked)} />{t("dimension_ack")}</label>
        {stale || error ? <p role="alert" className="text-sm text-red-700">{error || t("dimension_stale")}</p> : null}
        <button type="button" className={`${dimensionButtonClass} border-cta bg-cta text-white`} onClick={apply} disabled={disabled || stale || invalid || !acknowledged}>{t("dimension_apply")}</button>
      </div> : null}
    </div>
  </div>, document.body);
}
