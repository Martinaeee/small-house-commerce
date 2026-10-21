"use client";

import { useId, useState } from "react";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import {
  parsePackagingText,
  PRODUCT_SIZE_AXES,
  type PackagingParseResult,
} from "@/lib/parse-packaging-input";
import { inputClsCompact } from "./Field";

type ProductDimensionField =
  | "width"
  | "height"
  | "depth"
  | "foldedWidth"
  | "foldedHeight"
  | "foldedDepth";
type ProductDimensionTarget = "expanded" | "folded";
type ApplyMode = "fill-empty" | "replace";
type ProductDimensionPatch = Partial<Record<ProductDimensionField, string>>;
type ParsedDimensionField = "packageWidth" | "packageHeight" | "packageDepth";

const TARGET_FIELDS: Record<
  ProductDimensionTarget,
  readonly {
    field: ProductDimensionField;
    parsedField: ParsedDimensionField;
    labelKey: TKey;
  }[]
> = {
  expanded: [
    { field: "width", parsedField: "packageWidth", labelKey: "product_dim_width" },
    { field: "depth", parsedField: "packageDepth", labelKey: "product_dim_depth" },
    { field: "height", parsedField: "packageHeight", labelKey: "product_dim_height" },
  ],
  folded: [
    {
      field: "foldedWidth",
      parsedField: "packageWidth",
      labelKey: "product_dim_folded_width",
    },
    {
      field: "foldedDepth",
      parsedField: "packageDepth",
      labelKey: "product_dim_folded_depth",
    },
    {
      field: "foldedHeight",
      parsedField: "packageHeight",
      labelKey: "product_dim_folded_height",
    },
  ],
};

export function ProductDimensionsAssist({
  value,
  onApply,
  disabled = false,
}: {
  value: Record<ProductDimensionField, string>;
  onApply: (patch: ProductDimensionPatch) => void;
  disabled?: boolean;
}) {
  const { t } = useAdminI18n();
  const id = useId();
  const inputId = `${id}-input`;
  const targetId = `${id}-target`;
  const modeId = `${id}-mode`;
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<ProductDimensionTarget>("expanded");
  const [mode, setMode] = useState<ApplyMode>("fill-empty");
  const [result, setResult] = useState<PackagingParseResult | null>(null);

  const apply = (): void => {
    if (!result) return;
    const patch: ProductDimensionPatch = {};
    for (const { field, parsedField } of TARGET_FIELDS[target]) {
      const parsed = result.fields[parsedField];
      if (parsed === undefined) continue;
      if (mode === "fill-empty" && value[field].trim() !== "") continue;
      patch[field] = String(parsed);
    }
    if (Object.keys(patch).length > 0) onApply(patch);
    setResult(null);
  };

  return (
    <div className="rounded-lg border border-border/70 bg-background p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 text-xs font-semibold text-ink" htmlFor={targetId}>
          {t("product_dimensions_assist_target")}
          <select
            id={targetId}
            className={`${inputClsCompact} mt-2 h-9 w-full text-xs`}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as ProductDimensionTarget);
              setResult(null);
            }}
            disabled={disabled}
          >
            <option value="expanded">
              {t("product_dimensions_assist_target_expanded")}
            </option>
            <option value="folded">
              {t("product_dimensions_assist_target_folded")}
            </option>
          </select>
        </label>
        <label className="min-w-64 flex-[2] text-xs font-semibold text-ink" htmlFor={inputId}>
          {t("product_dimensions_assist_label")}
          <textarea
            id={inputId}
            className={`${inputClsCompact} mt-2 min-h-16 w-full resize-y`}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setResult(null);
            }}
            placeholder={t("product_dimensions_assist_placeholder")}
            disabled={disabled}
          />
        </label>
      </div>
      <button
        type="button"
        className="mt-2 h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-ink hover:border-primary disabled:text-ink-muted"
        onClick={() =>
          setResult(parsePackagingText(input, "dimensions", PRODUCT_SIZE_AXES))
        }
        disabled={disabled || input.trim() === ""}
      >
        {t("product_dimensions_assist_parse")}
      </button>

      {result ? (
        <div role="status" className="mt-3 border-t border-border/70 pt-3">
          <p className="text-xs font-semibold text-ink">
            {t("packaging_assist_preview")}
          </p>
          {Object.keys(result.fields).length === 0 ? (
            <p className="mt-2 text-xs text-red-700">
              {t("product_dimensions_assist_no_values")}
            </p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-secondary sm:grid-cols-3">
              {TARGET_FIELDS[target].map(({ field, parsedField, labelKey }) => {
                const parsed = result.fields[parsedField];
                return parsed === undefined ? null : (
                  <div key={field} className="flex items-center justify-between gap-2">
                    <dt>{t(labelKey)}</dt>
                    <dd className="font-semibold text-ink">{parsed} cm</dd>
                  </div>
                );
              })}
            </dl>
          )}
          {result.warnings.map((warning) => (
            <p key={warning} className="mt-1 text-xs text-red-700">
              {t("packaging_assist_warning", { message: warning })}
            </p>
          ))}
          {result.assumptions.map((assumption) => (
            <p key={assumption} className="mt-1 text-xs text-ink-muted">
              {t("packaging_assist_assumption", { message: assumption })}
            </p>
          ))}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-ink" htmlFor={modeId}>
              {t("product_dimensions_assist_mode_aria")}
            </label>
            <select
              id={modeId}
              aria-label={t("product_dimensions_assist_mode_aria")}
              className={`${inputClsCompact} h-9 text-xs`}
              value={mode}
              onChange={(event) => setMode(event.target.value as ApplyMode)}
              disabled={disabled}
            >
              <option value="fill-empty">{t("packaging_assist_fill_empty")}</option>
              <option value="replace">{t("packaging_assist_replace")}</option>
            </select>
            <button
              type="button"
              className="h-9 rounded-lg bg-cta px-3 text-xs font-semibold text-white disabled:opacity-50"
              onClick={apply}
              disabled={disabled || Object.keys(result.fields).length === 0}
            >
              {t("packaging_assist_apply")}
            </button>
            <button
              type="button"
              className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-ink hover:border-primary disabled:text-ink-muted"
              onClick={() => setResult(null)}
              disabled={disabled}
            >
              {t("packaging_assist_cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
