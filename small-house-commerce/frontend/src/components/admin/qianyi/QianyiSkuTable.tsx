"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { adminApi, type AdminQianyiSkuRow } from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";
import { optimizedUploadImage } from "@/lib/image-url";

export function QianyiSkuTable({ rows, onMapped }: {
  rows: AdminQianyiSkuRow[];
  onMapped: (id: string, code: string | null) => void;
}) {
  const { t } = useAdminI18n();
  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface text-xs text-muted shadow-sm">
          <tr>
            <th scope="col" className="w-14 px-3 py-3" aria-label={t("qianyi_col_photo")} />
            <th scope="col" className="px-3 py-3">{t("qianyi_col_sku")}</th>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_title")}</th>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_code")}</th>
            <th scope="col" className="px-3 py-3">{t("qianyi_col_state")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <MappingRow key={row.id} row={row} onMapped={onMapped} />)}
        </tbody>
      </table>
    </div>
  );
}

// Each row owns its request and feedback: saving a second SKU must not hide
// the first one's error, nor roll back a successful save after a failed refresh.
function MappingRow({ row, onMapped }: {
  row: AdminQianyiSkuRow;
  onMapped: (id: string, code: string | null) => void;
}) {
  const { t } = useAdminI18n();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const inFlight = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapped = Boolean(row.qianyiSkuCode?.trim());
  const gaps = {
    packageWeight: t("qianyi_gap_packageWeight"),
    productWeight: t("qianyi_gap_productWeight"),
    packageWidth: t("qianyi_gap_packageWidth"),
    packageHeight: t("qianyi_gap_packageHeight"),
    packageDepth: t("qianyi_gap_packageDepth"),
  };

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = async (input: HTMLInputElement) => {
    const value = input.value.trim();
    if (inFlight.current || value === (row.qianyiSkuCode ?? "")) return;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setErrorCode(null);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    try {
      const result = await adminApi.setQianyiMapping(row.id, value || null);
      input.value = result.qianyiSkuCode ?? "";
      onMapped(row.id, result.qianyiSkuCode);
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
    } catch {
      input.value = row.qianyiSkuCode ?? "";
      setErrorCode(value);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Fragment>
      <tr className="border-t border-border/60 align-middle hover:bg-border/10">
        <td className="px-3 py-2">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={optimizedUploadImage(row.imageUrl, 96)} alt={`${t("qianyi_photo_alt")} ${row.skuCode}`}
              width={40} height={40} loading="lazy" className="h-10 w-10 rounded object-cover" />
          ) : <div aria-label={t("qianyi_no_photo")} className="h-10 w-10 rounded bg-border/40" />}
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-medium">{row.skuCode}</td>
        <td className="px-3 py-2">
          <span className="block max-w-sm">{row.title}</span>
          {row.variantName ? <span className="text-xs text-muted">{row.variantName}</span> : null}
        </td>
        <td className="w-52 px-3 py-2">
          <input aria-label={`qianyi code for ${row.skuCode}`} defaultValue={row.qianyiSkuCode ?? ""}
            placeholder={t("qianyi_code_placeholder")} disabled={saving} aria-invalid={errorCode !== null}
            aria-describedby={errorCode !== null ? `mapping-error-${row.id}` : undefined}
            onBlur={(event) => void save(event.currentTarget)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur(); }}
            className={`h-9 w-44 rounded border bg-surface px-2 text-sm disabled:opacity-60 ${errorCode !== null ? "border-red-500" : "border-border"}`} />
          <span role="status" className="mt-1 block text-xs text-primary">
            {saving ? t("qianyi_saving") : saved ? <><span aria-hidden="true">✓ </span>{t("qianyi_saved")}</> : null}
          </span>
          {errorCode !== null ? (
            <p id={`mapping-error-${row.id}`} role="alert" className="mt-1 max-w-56 text-xs text-red-700">
              {t("qianyi_mapping_failed", { code: errorCode })}
            </p>
          ) : null}
        </td>
        <td className="px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 font-medium ${mapped ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>
              {mapped ? t("qianyi_bind_bound") : t("qianyi_bind_unbound")}
            </span>
            {row.ready ? <span className="text-muted">{t("qianyi_ready")}</span> : (
              <button type="button" aria-expanded={expanded} aria-controls={`gaps-${row.id}`}
                onClick={() => setExpanded(!expanded)} className="rounded-full bg-amber-50 px-2 py-1 text-amber-800 hover:bg-amber-100">
                {t("qianyi_missing", { gaps: row.gaps.length })} {expanded ? "−" : "+"}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr id={`gaps-${row.id}`} className="bg-border/10">
          <td colSpan={5} className="px-4 py-3 text-xs text-muted">
            <span className="font-medium text-ink">{row.gaps.map((gap) => gaps[gap as keyof typeof gaps] ?? gap).join(" / ")}</span>
            <span className="ml-3">{t("qianyi_gap_hint")}</span>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
