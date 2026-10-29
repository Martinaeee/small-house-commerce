"use client";

import { useState } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { MarketingReportRow, MarketingReportTreeProduct } from "@/lib/marketing-api";
import { reportColumns, ReportMetricCells, ProductThumb } from "./ReportColumns";

const chevron = (open: boolean) => <span aria-hidden className="inline-block w-3 text-admin-muted">{open ? "▾" : "▸"}</span>;

/**
 * Product → source-type → link tree. Every level is a real <tr>, so metric
 * columns stay aligned with the flat table. Collapse state lives in this
 * component only; a reload re-expands everything.
 */
export function ReportTreeTable({ tree, sortBy, sortDirection, onSort }: {
  tree: MarketingReportTreeProduct[];
  sortBy: string;
  sortDirection: "ASC" | "DESC";
  onSort: (column?: string, firstClickDesc?: boolean) => void;
}) {
  const { t } = useAdminI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const open = (key: string) => !collapsed.has(key);
  if (tree.length === 0) return <p className="text-sm text-admin-muted">{t("marketing_report_empty")}</p>;
  return <div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm">
    <thead className="bg-slate-50 text-xs text-admin-muted"><tr>
      <th className="min-w-56 px-3 py-2"><button type="button" onClick={() => onSort("NAME", false)}>{t("marketing_internal_name")}{sortBy === "NAME" ? (sortDirection === "ASC" ? " ▲" : " ▼") : ""}</button></th>
      {reportColumns.slice(1).map(column => <th key={column.key} className="whitespace-nowrap px-3 py-2">{column.sortBy
        ? <button type="button" onClick={() => onSort(column.sortBy, column.numeric)}>{t(column.key as Parameters<typeof t>[0])}{sortBy === column.sortBy ? (sortDirection === "ASC" ? " ▲" : " ▼") : ""}</button>
        : t(column.key as Parameters<typeof t>[0])}</th>)}
    </tr></thead>
    <tbody className="divide-y divide-admin-border">
      {tree.map(group => <>
        <tr key={group.product.id} className="bg-slate-50 align-top">
          <td className="px-3 py-3">
            <div className="flex items-start gap-2">
              <button type="button" aria-expanded={open(group.product.id)} aria-label={group.product.name} className="mt-0.5 px-1" onClick={() => toggle(group.product.id)}>{chevron(open(group.product.id))}</button>
              <ProductThumb url={group.product.thumbnailUrl} label={group.product.name} />
              <div>
                <p className="font-semibold">{group.product.name}</p>
                <p className="mt-1 text-xs text-admin-muted">{group.product.productCode ?? ""}</p>
              </div>
            </div>
          </td>
          <ReportMetricCells row={group.totals} />
        </tr>
        {open(group.product.id) && group.sources.map(source => <>
          <tr key={`${group.product.id}:${source.sourceType}`} className="align-top">
            <td className="px-3 py-3 pl-12">
              <div className="flex items-center gap-2">
                <button type="button" aria-expanded={open(`${group.product.id}:${source.sourceType}`)} aria-label={`${t(`marketing_source_${source.sourceType}` as Parameters<typeof t>[0])} ${t("marketing_report_view_tree")}`} className="px-1" onClick={() => toggle(`${group.product.id}:${source.sourceType}`)}>{chevron(open(`${group.product.id}:${source.sourceType}`))}</button>
                <span className="font-medium">{t(`marketing_source_${source.sourceType}` as Parameters<typeof t>[0])}</span>
              </div>
            </td>
            <ReportMetricCells row={source.totals} />
          </tr>
          {open(`${group.product.id}:${source.sourceType}`) && source.links.map(link => (
            <tr key={link.id} className="align-top">
              <td className="px-3 py-3 pl-20 text-admin-muted"><p>{link.label}</p><p className="text-xs text-admin-muted">{link.productName ?? ""}</p></td>
              <ReportMetricCells row={link} />
            </tr>
          ))}
        </>)}
      </>)}
    </tbody>
  </table></div>;
}
