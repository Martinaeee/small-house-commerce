"use client";

import { useId, useState } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { parseProductDimensionInput, type DimensionConfig } from "@/lib/admin-dimension-import";
import { DimensionConventionControls, dimensionButtonClass, dimensionInputClass } from "./product-form/ProductDimensionImportDialog";

type ProductDimensionField = "width" | "height" | "depth" | "foldedWidth" | "foldedHeight" | "foldedDepth";
type ProductDimensionTarget = "expanded" | "folded";
type ProductDimensionPatch = Partial<Record<ProductDimensionField, string>>;
const TARGET_FIELDS: Record<ProductDimensionTarget, { field: ProductDimensionField; parsedField: "productWidth" | "productDepth" | "productHeight"; labelKey: TKey }[]> = {
  expanded: [
    { field: "width", parsedField: "productWidth", labelKey: "product_dim_width" },
    { field: "depth", parsedField: "productDepth", labelKey: "product_dim_depth" },
    { field: "height", parsedField: "productHeight", labelKey: "product_dim_height" },
  ],
  folded: [
    { field: "foldedWidth", parsedField: "productWidth", labelKey: "product_dim_folded_width" },
    { field: "foldedDepth", parsedField: "productDepth", labelKey: "product_dim_folded_depth" },
    { field: "foldedHeight", parsedField: "productHeight", labelKey: "product_dim_folded_height" },
  ],
};

export function ProductDimensionsAssist({ value, onApply, disabled = false }: {
  value: Record<ProductDimensionField, string>; onApply: (patch: ProductDimensionPatch) => void; disabled?: boolean;
}) {
  const { t } = useAdminI18n();
  const id = useId();
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<ProductDimensionTarget>("expanded");
  const [mode, setMode] = useState<"fill-empty" | "replace">("fill-empty");
  const [config, setConfig] = useState<DimensionConfig>({ order: "", unit: "" });
  const [result, setResult] = useState<{ parsed: ReturnType<typeof parseProductDimensionInput>; fingerprint: string } | null>(null);
  const fingerprint = JSON.stringify(TARGET_FIELDS[target].map(({ field }) => value[field]));
  const stale = result !== null && result.fingerprint !== fingerprint;
  const apply = () => {
    if (!result?.parsed.dimensions || result.parsed.issue || stale || disabled) return;
    const patch: ProductDimensionPatch = {};
    for (const { field, parsedField } of TARGET_FIELDS[target]) {
      if (mode === "fill-empty" && value[field].trim() !== "") continue;
      patch[field] = String(result.parsed.dimensions[parsedField]);
    }
    if (Object.keys(patch).length) onApply(patch);
    setResult(null);
  };
  return <div className="space-y-3 rounded-lg bg-background p-3">
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-col gap-1 text-sm font-medium" htmlFor={`${id}-target`}>
        {t("product_dimensions_assist_target")}
        <select id={`${id}-target`} className={dimensionInputClass} value={target} disabled={disabled} onChange={event => { setTarget(event.target.value as ProductDimensionTarget); setResult(null); }}>
          <option value="expanded">{t("product_dimensions_assist_target_expanded")}</option>
          <option value="folded">{t("product_dimensions_assist_target_folded")}</option>
        </select>
      </label>
      <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-sm font-medium" htmlFor={`${id}-input`}>
        {t("product_dimensions_assist_label")}
        <textarea id={`${id}-input`} className={`${dimensionInputClass} min-h-16 w-full resize-y py-2`} value={input} disabled={disabled} placeholder={t("product_dimensions_assist_placeholder")}
          onChange={event => { setInput(event.target.value); setResult(null); }} />
      </label>
    </div>
    <DimensionConventionControls order={config.order} unit={config.unit} disabled={disabled} onChange={next => { setConfig(next); setResult(null); }} />
    <button type="button" className={dimensionButtonClass} disabled={disabled || !input.trim()} onClick={() => setResult({ parsed: parseProductDimensionInput(input, { ...config, target }), fingerprint })}>{t("product_dimensions_assist_parse")}</button>
    {result ? <div role="status" className="space-y-3 border-t border-border pt-3 text-sm">
      {result.parsed.issue ? <p className="text-red-700">{t(result.parsed.issue)}</p> : <>
        <p className="font-semibold">{t("packaging_assist_preview")}</p>
        <dl className="grid gap-2 sm:grid-cols-3">{TARGET_FIELDS[target].map(({ field, parsedField, labelKey }) => <div key={field} className="flex items-center justify-between gap-2"><dt>{t(labelKey)}</dt><dd className="font-semibold">{result.parsed.dimensions?.[parsedField]} cm</dd></div>)}</dl>
      </>}
      {stale ? <p className="text-red-700">{t("dimension_stale")}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-mode`}>{t("product_dimensions_assist_mode_aria")}</label>
        <select id={`${id}-mode`} className={dimensionInputClass} value={mode} disabled={disabled} onChange={event => setMode(event.target.value as typeof mode)}>
          <option value="fill-empty">{t("packaging_assist_fill_empty")}</option>
          <option value="replace">{t("packaging_assist_replace")}</option>
        </select>
        <button type="button" className={`${dimensionButtonClass} border-cta bg-cta text-white`} disabled={disabled || stale || result.parsed.dimensions === null} onClick={apply}>{t("packaging_assist_apply")}</button>
        <button type="button" className={dimensionButtonClass} disabled={disabled} onClick={() => setResult(null)}>{t("packaging_assist_cancel")}</button>
      </div>
    </div> : null}
  </div>;
}
