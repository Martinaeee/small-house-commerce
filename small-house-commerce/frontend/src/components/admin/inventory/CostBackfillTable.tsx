"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, type AdminSkuCostRow } from "@/lib/admin-api";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { DecimalInput } from "@/components/admin/DecimalInput";
import { EmptyState } from "@/components/admin/EmptyState";
import { Field, TextInput } from "@/components/admin/Field";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { Button } from "@/components/ui/Button";

interface Failure {
  skuCode: string;
  error: string;
}

/**
 * Cost backfill grid.
 *
 * The dashboard only publishes a profit once every line of a product carries
 * a cost snapshot, and a snapshot is only written when the SKU had a landed
 * cost at checkout time. Filling costs one product at a time is slow, so
 * this grid lists every active SKU with its stock and its last 30 days of
 * sales, and writes the landed cost in one batch.
 *
 * The default view is the SKUs that still have no cost, busiest first —
 * that is where the missing money is.
 */
export function CostBackfillTable() {
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const canEdit = hasPermission("PRODUCT_MANAGE");

  const [rows, setRows] = useState<AdminSkuCostRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // Loading is derived: the grid is loading until the first answer arrives.
  const loading = rows === null && loadError === null;

  useEffect(() => {
    let active = true;
    adminApi
      .inventoryCosts()
      .then((data) => {
        if (!active) return;
        setRows(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load costs.");
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rows ?? [])
      .filter((row) => {
        if (onlyMissing && row.landedCost !== null) return false;
        if (!needle) return true;
        return (
          row.productName.toLowerCase().includes(needle) ||
          row.variantName.toLowerCase().includes(needle) ||
          row.skuCode.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => b.unitsSold30d - a.unitsSold30d || a.skuCode.localeCompare(b.skuCode));
  }, [rows, search, onlyMissing]);

  const dirtyRows = useMemo(
    () =>
      visibleRows.filter(
        (row) =>
          row.skuId in drafts && !Object.is(drafts[row.skuId], row.landedCost),
      ),
    [visibleRows, drafts],
  );

  const missingCount = useMemo(
    () => (rows ?? []).filter((row) => row.landedCost === null).length,
    [rows],
  );

  async function save() {
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setFailures([]);
    setSavedCount(null);
    try {
      const results = await adminApi.setInventoryCosts({
        items: dirtyRows.map((row) => ({
          skuId: row.skuId,
          landedCost: drafts[row.skuId] ?? null,
        })),
      });
      const failed: Failure[] = [];
      const okBySku = new Map<string, number | null>();
      for (const result of results) {
        if (result.ok) {
          okBySku.set(result.skuId, result.landedCost);
        } else {
          const row = dirtyRows.find((candidate) => candidate.skuId === result.skuId);
          failed.push({ skuCode: row?.skuCode ?? result.skuId, error: result.error });
        }
      }
      setRows((current) =>
        (current ?? []).map((row) =>
          okBySku.has(row.skuId)
            ? { ...row, landedCost: okBySku.get(row.skuId) ?? null }
            : row,
        ),
      );
      setDrafts((current) => {
        const next = { ...current };
        for (const skuId of okBySku.keys()) delete next[skuId];
        return next;
      });
      setFailures(failed);
      setSavedCount(okBySku.size);
    } catch (error) {
      setFailures([
        {
          skuCode: t("cost_batch"),
          error: error instanceof Error ? error.message : "Save failed",
        },
      ]);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDrafts({});
    setFailures([]);
    setSavedCount(null);
  }

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <PageHeader title={t("cost_page_title")} subtitle={t("cost_page_subtitle")} />
        <div className="mt-4">
          <EmptyState
            title={t("dash_no_permission")}
            hint={t("cost_page_permission_hint")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title={t("cost_page_title")}
        subtitle={t("cost_page_subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={discard}
              disabled={dirtyRows.length === 0 || saving}
            >
              {t("cost_discard")}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={save}
              disabled={dirtyRows.length === 0 || saving}
            >
              {saving ? t("dash_loading") : t("cost_save", { count: dirtyRows.length })}
            </Button>
          </div>
        }
      />

      {rows ? (
        <p className="mt-3 text-xs text-ink-muted">
          {t("cost_summary", {
            total: rows.length,
            missing: missingCount,
            shown: visibleRows.length,
          })}
        </p>
      ) : null}

      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="md:min-w-[220px] md:flex-1">
            <Field label={t("cost_search")} htmlFor="cost-search">
              <TextInput
                id="cost-search"
                type="search"
                placeholder={t("cost_search_placeholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(event) => setOnlyMissing(event.target.checked)}
            />
            {t("cost_only_missing")}
          </label>
        </div>
      </div>

      {savedCount !== null && savedCount > 0 ? (
        <p className="mt-3 text-sm font-medium text-admin-success">
          {t("cost_saved", { count: savedCount })}
        </p>
      ) : null}
      {failures.length > 0 ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-admin-error bg-admin-error-soft px-3 py-2 text-sm text-admin-error"
        >
          <p className="font-semibold">{t("cost_save_failed", { count: failures.length })}</p>
          <ul className="mt-1 space-y-0.5">
            {failures.map((failure) => (
              <li key={failure.skuCode} className="text-xs">
                {failure.skuCode}: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : loadError ? (
          <EmptyState
            title={t("cost_load_failed")}
            hint={loadError}
            action={
              <Button
                variant="secondary"
                size="md"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                {t("dash_retry")}
              </Button>
            }
          />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            title={onlyMissing ? t("cost_none_missing") : t("cost_no_match")}
            hint={t("cost_grid_hint")}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2 font-medium">{t("dash_product")}</th>
                  <th className="px-2 py-2 font-medium">SKU</th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("cost_supplier_cost")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("cost_landed_cost")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("cost_available")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("cost_sold_30d")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const draft = row.skuId in drafts ? drafts[row.skuId] : row.landedCost;
                  const dirty = row.skuId in drafts && !Object.is(drafts[row.skuId], row.landedCost);
                  return (
                    <tr
                      key={row.skuId}
                      className={`border-b border-border last:border-0 ${
                        dirty ? "bg-admin-warning-soft/40" : ""
                      }`}
                    >
                      <td className="px-4 py-2">
                        <p className="truncate text-ink">{row.productName}</p>
                        <p className="truncate text-[11px] text-ink-muted">{row.variantName}</p>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-ink-secondary">
                        {row.skuCode}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-secondary">
                        {row.supplierCost === null ? "—" : row.supplierCost}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          {dirty ? (
                            <span
                              className="text-[10px] font-semibold text-admin-warning"
                              aria-label={t("cost_dirty")}
                            >
                              •
                            </span>
                          ) : null}
                          <DecimalInput
                            id={`landed-cost-${row.skuId}`}
                            className="w-28 text-right"
                            value={draft ?? null}
                            onValueChange={(value) =>
                              setDrafts((current) => ({ ...current, [row.skuId]: value }))
                            }
                            placeholder="—"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-secondary">
                        {row.available}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-secondary">
                        {row.unitsSold30d}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
