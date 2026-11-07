"use client";
import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi } from "@/lib/marketing-api";
import {
  funnelApi,
  type FunnelFilters,
  type FunnelReport,
  type FunnelRow,
} from "@/lib/funnel-api";
import { quickDateRange, marketingDay } from "@/lib/quick-date-range";
import { DateRangePicker } from "./DateRangePicker";
import { ProductThumb } from "./ReportColumns";
import { ProductFunnelDrawer } from "./ProductFunnelDrawer";

import { funnelPercent, funnelField, funnelButton } from "./funnel-display";
const columns = [
  "visits",
  "views",
  "addToCarts",
  "checkouts",
  "attempts",
  "failures",
  "orders",
] as const;
const failureReasons = [
  "VALIDATION",
  "STOCK",
  "NETWORK",
  "SERVER",
  "UNKNOWN",
] as const;
const rateKeys = {
  visits: null,
  views: "VIEW",
  addToCarts: "ADD_TO_CART",
  checkouts: "CHECKOUT",
  attempts: "ATTEMPT",
  failures: "FAILURE",
  orders: "ORDER",
} as const;
export function ProductFunnel({
  productId,
  ownerUserId,
}: {
  productId?: string;
  ownerUserId?: string;
}) {
  const { admin } = useAdminAuth(),
    { t } = useAdminI18n();
  const [filters, setFilters] = useState(() => ({
    ...quickDateRange("LAST_7_DAYS"),
    traffic: "ALL" as FunnelFilters["traffic"],
    ownerUserId: ownerUserId ?? "",
    productId,
  }));
  const [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [onlyAnomaly, setOnlyAnomaly] = useState(false),
    [sort, setSort] = useState("CONVERSION");
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [owners, setOwners] = useState<
    Awaited<ReturnType<typeof marketingApi.ownerOptions>>
  >([]);
  const [selected, setSelected] = useState<FunnelRow | null>(null);
  const [loaded, setLoaded] = useState<{
      key: string;
      data: FunnelReport;
    } | null>(null),
    [error, setError] = useState<{ key: string; message: string } | null>(null);
  const adminId = admin?.id;
  const all = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));
  const query = {
    ...filters,
    ownerUserId: all ? filters.ownerUserId || undefined : undefined,
    q,
    sort,
    onlyAnomaly: String(onlyAnomaly),
    page,
  };
  const queryJSON = JSON.stringify(query),
    key = JSON.stringify([admin?.id, admin?.permissions, queryJSON, revision]);
  useEffect(() => {
    if (!adminId) return;
    let alive = true;
    funnelApi
      .list(JSON.parse(queryJSON))
      .then((data) => {
        if (alive) {
          setLoaded({ key, data });
          setError(null);
        }
      })
      .catch((e) => {
        if (alive)
          setError({
            key,
            message: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      alive = false;
    };
  }, [adminId, key, queryJSON]);
  useEffect(() => {
    if (!all) return;
    let alive = true;
    marketingApi
      .ownerOptions()
      .then((v) => {
        if (alive) setOwners(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [all]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRevision((v) => v + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  const data = loaded?.key === key ? loaded.data : null,
    loadError = error?.key === key ? error.message : null;
  function change(patch: Partial<typeof filters>) {
    setFilters((v) => ({ ...v, ...patch }));
    setPage(1);
    setSelected(null);
  }
  return (
    <section className="space-y-3 min-w-0" aria-label={t("funnel_title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t("funnel_title")}</h2>
          <p className="text-xs text-admin-muted">{t("funnel_hint")}</p>
        </div>
        <button
          className={funnelButton}
          onClick={() => setRevision((v) => v + 1)}
        >
          {t("funnel_refresh")}
        </button>
      </div>
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-admin-border bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search);
          setPage(1);
        }}
      >
        <label className="w-80 max-w-full text-xs text-admin-muted">
          {t("funnel_dates")}
          <DateRangePicker
            label={t("funnel_dates")}
            value={filters}
            max={marketingDay()}
            onChange={(v) =>
              change({ from: v.from ?? filters.from, to: v.to ?? filters.to })
            }
          />
        </label>
        <label className="grid gap-1 text-xs text-admin-muted">
          {t("funnel_traffic")}
          <select
            className={funnelField}
            value={filters.traffic}
            onChange={(e) =>
              change({ traffic: e.target.value as FunnelFilters["traffic"] })
            }
          >
            {(["ALL", "ADS", "ORGANIC"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`funnel_${v}`)}
              </option>
            ))}
          </select>
        </label>
        {all && (
          <label className="grid gap-1 text-xs text-admin-muted">
            {t("funnel_owner")}
            <select
              className={`${funnelField} max-w-48`}
              value={filters.ownerUserId}
              onChange={(e) => change({ ownerUserId: e.target.value })}
            >
              <option value="">{t("funnel_all_owners")}</option>
              {owners.map((o) => (
                <option key={o.userId} value={o.userId}>
                  {o.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs text-admin-muted">
          {t("funnel_search")}
          <input
            className={funnelField}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 py-2 text-xs">
          <input
            type="checkbox"
            checked={onlyAnomaly}
            onChange={(e) => {
              setOnlyAnomaly(e.target.checked);
              setPage(1);
            }}
          />
          {t("funnel_only_anomaly")}
        </label>
        <select
          className={funnelField}
          aria-label={t("marketing_report_sort_hint")}
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          {(
            [
              "ORDER_COUNT",
              "VISITS",
              "CONVERSION",
              "ADD_TO_CART_RATE",
              "CHECKOUT_RATE",
              "SUBMIT_RATE",
              "FAILURE_RATE",
            ] as const
          ).map((s, i) => (
            <option key={s} value={s}>
              {t(
                (
                  [
                    "funnel_orders",
                    "funnel_visits",
                    "funnel_conversion",
                    "funnel_addToCarts",
                    "funnel_checkouts",
                    "funnel_attempts",
                    "funnel_failures",
                  ] as const
                )[i],
              )}
            </option>
          ))}
        </select>
        <button
          className={`${funnelButton} bg-cta text-cta-foreground`}
          type="submit"
        >
          {t("funnel_apply")}
        </button>
      </form>
      <p className="text-xs text-admin-muted">{t("funnel_coverage")}</p>
      {!all && (
        <p className="text-xs text-admin-muted">{t("funnel_scope_hint")}</p>
      )}
      {loadError ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 p-3 text-sm text-sale"
        >
          {loadError}{" "}
          <button
            className={funnelButton}
            onClick={() => setRevision((v) => v + 1)}
          >
            {t("funnel_retry")}
          </button>
        </p>
      ) : !data ? (
        <p role="status" className="p-6 text-center text-admin-muted">
          {t("funnel_loading")}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-admin-muted">
                <tr>
                  <th className="sticky left-0 z-10 min-w-56 bg-slate-50 p-3">
                    {t("funnel_product")}
                  </th>
                  {columns.map((c) => (
                    <th key={c} className="whitespace-nowrap p-3 text-right">
                      {t(`funnel_${c}`)}
                    </th>
                  ))}
                  <th className="whitespace-nowrap p-3 text-right">
                    {t("funnel_conversion")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {data.rows.map((row) => (
                  <tr key={row.productId} className="align-top">
                    <td className="sticky left-0 z-10 bg-white p-3">
                      <div className="flex items-center gap-2">
                        <ProductThumb
                          url={row.thumbnailUrl}
                          label={row.productName}
                        />
                        <div>
                          <button
                            className="text-left font-medium underline-offset-2 hover:underline"
                            onClick={() => setSelected(row)}
                          >
                            {row.productName}
                          </button>
                          <p className="text-xs text-admin-muted">
                            {row.productCode ?? "—"}
                          </p>
                        </div>
                      </div>
                    </td>
                    {columns.map((c) => {
                      const step = row.steps.find((s) => s.key === rateKeys[c]);
                      return (
                        <td
                          key={c}
                          className="p-3 text-right tabular-nums"
                          data-testid={`funnel-${c}-${row.productId}`}
                          title={
                            c === "failures"
                              ? failureReasons
                                  .map((reason) => {
                                    const count =
                                      row.failureReasons[reason] ?? 0;
                                    return `${t(`funnel_reason_${reason}`)}: ${count} (${funnelPercent(row.failures ? count / row.failures : 0)})`;
                                  })
                                  .join("\n")
                              : undefined
                          }
                        >
                          <span>{row[c]}</span>
                          {step && (
                            <div className="whitespace-nowrap text-[11px] text-admin-muted">
                              {funnelPercent(step.rate)}{" "}
                              {step.flagged && (
                                <button
                                  data-testid={`funnel-flag-${row.productId}-${step.key}`}
                                  onClick={() => setSelected(row)}
                                  className="rounded border border-red-200 bg-red-50 px-1 font-bold text-red-700"
                                  title={t("funnel_anomaly", {
                                    current: funnelPercent(step.rate),
                                    baseline: funnelPercent(step.baselineRate),
                                  })}
                                >
                                  !
                                </button>
                              )}
                              {step.sampleSmall && (
                                <span className="block text-[10px]">
                                  {t("funnel_sample")}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-3 text-right tabular-nums">
                      {funnelPercent(row.conversion)}
                    </td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr>
                    <td
                      colSpan={9}
                      className="p-8 text-center text-admin-muted"
                    >
                      {t("funnel_empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-admin-muted">
            <span>
              {t("funnel_updated", {
                time: new Intl.DateTimeFormat("en-PH", {
                  timeZone: "Asia/Manila",
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(data.asOf)),
              })}
            </span>
            <div className="flex items-center gap-2">
              <button
                className={funnelButton}
                disabled={page <= 1}
                onClick={() => setPage((v) => v - 1)}
              >
                {t("funnel_prev")}
              </button>
              <span>
                {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <button
                className={funnelButton}
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage((v) => v + 1)}
              >
                {t("funnel_next")}
              </button>
            </div>
          </div>
        </>
      )}
      <details className="text-xs text-admin-muted">
        <summary className="cursor-pointer">
          {t("marketing_report_notes")}
        </summary>
        <p className="max-w-5xl pt-2 leading-6">{t("funnel_rules")}</p>
      </details>
      {selected && (
        <ProductFunnelDrawer
          key={JSON.stringify([
            selected.productId,
            filters,
            admin?.id,
            admin?.permissions,
          ])}
          row={selected}
          filters={filters}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
