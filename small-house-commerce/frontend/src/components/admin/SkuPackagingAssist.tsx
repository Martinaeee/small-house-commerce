"use client";

import { useId, useState } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  parsePackagingText,
  type PackagingParseResult,
} from "@/lib/parse-packaging-input";
import type { AdminSkuDraft } from "@/lib/admin-product-graph";
import { inputClsCompact } from "./Field";

const PACKAGE_FIELDS = [
  "packageWidth",
  "packageDepth",
  "packageHeight",
  "packageWeight",
] as const;

type PackageField = (typeof PACKAGE_FIELDS)[number];
type ApplyMode = "fill-empty" | "replace";
type PackagePatch = Partial<Pick<AdminSkuDraft, PackageField>>;

export function SkuPackagingAssist({
  value,
  onApply,
  disabled = false,
}: {
  value: Pick<AdminSkuDraft, PackageField>;
  onApply: (patch: PackagePatch, mode: ApplyMode) => void;
  disabled?: boolean;
}) {
  const { t } = useAdminI18n();
  const id = useId();
  const inputId = `${id}-input`;
  const modeId = `${id}-mode`;
  const [input, setInput] = useState("");
  const [result, setResult] = useState<PackagingParseResult | null>(null);
  const [mode, setMode] = useState<ApplyMode>("fill-empty");

  const apply = (): void => {
    if (!result) return;
    const patch: PackagePatch = {};
    for (const field of PACKAGE_FIELDS) {
      const parsed = result.fields[field];
      if (parsed === undefined) continue;
      if (mode === "fill-empty" && value[field] !== null && value[field] !== undefined) {
        continue;
      }
      patch[field] = parsed;
    }
    if (Object.keys(patch).length > 0) onApply(patch, mode);
    setResult(null);
  };

  const previewFields: Array<[PackageField, number | undefined, string]> = [
    ["packageWidth", result?.fields.packageWidth, t("packaging_assist_width")],
    ["packageDepth", result?.fields.packageDepth, t("packaging_assist_depth")],
    ["packageHeight", result?.fields.packageHeight, t("packaging_assist_height")],
    ["packageWeight", result?.fields.packageWeight, t("packaging_assist_weight")],
  ];

  return (
    <div className="mt-2 rounded-lg border border-border/70 bg-background p-3">
      <label
        htmlFor={inputId}
        className="block text-xs font-semibold text-ink"
      >
        {t("packaging_assist_label")}
      </label>
      <textarea
        id={inputId}
        className={`${inputClsCompact} mt-2 min-h-16 w-full resize-y`}
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          setResult(null);
        }}
        placeholder={t("packaging_assist_placeholder")}
        disabled={disabled}
      />
      <button
        type="button"
        className="mt-2 h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-ink hover:border-primary disabled:text-ink-muted"
        onClick={() => setResult(parsePackagingText(input, "combined"))}
        disabled={disabled || input.trim() === ""}
      >
        {t("packaging_assist_parse")}
      </button>

      {result ? (
        <div role="status" className="mt-3 border-t border-border/70 pt-3">
          <p className="text-xs font-semibold text-ink">
            {t("packaging_assist_preview")}
          </p>
          {Object.keys(result.fields).length === 0 ? (
            <p className="mt-2 text-xs text-red-700">
              {t("packaging_assist_no_values")}
            </p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-secondary">
              {previewFields.map(([field, parsed, label]) =>
                parsed === undefined ? null : (
                  <div key={field} className="flex items-center justify-between gap-2">
                    <dt>{label}</dt>
                    <dd className="font-semibold text-ink">
                      {parsed} {field === "packageWeight" ? "kg" : "cm"}
                    </dd>
                  </div>
                ),
              )}
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
              {t("packaging_assist_mode_aria")}
            </label>
            <select
              id={modeId}
              aria-label={t("packaging_assist_mode_aria")}
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
