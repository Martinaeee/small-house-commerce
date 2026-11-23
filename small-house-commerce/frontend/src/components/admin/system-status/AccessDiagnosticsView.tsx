"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { AdminAccessErrorRow, AdminAccessReport, AdminAccessSlowRequest } from "@/lib/admin-api";
import type { TKey } from "@/lib/admin-i18n";
import {
  cacheState,
  imageKind,
  overallStatus,
  parseRequest,
  refererPath,
  type CacheState,
  type RequestKind,
} from "@/lib/access-diagnostics";

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;
type Tone = "healthy" | "warning" | "critical" | "unknown";

function tone5xx(rate: number | null): Tone {
  if (rate === null) return "unknown";
  if (rate === 0) return "healthy";
  if (rate < 0.5) return "warning";
  return "critical";
}

function tone4xx(rate: number | null): Tone {
  if (rate === null) return "unknown";
  if (rate < 2) return "healthy";
  if (rate < 5) return "warning";
  return "critical";
}

function toneCache(state: CacheState): Tone {
  switch (state) {
    case "normal":
      return "healthy";
    case "warming":
      return "warning";
    case "below_target":
      return "warning";
    case "failed":
      return "critical";
    default:
      return "unknown";
  }
}

function toneDuration(ms: number): Tone {
  if (ms < 1500) return "healthy";
  if (ms < 3000) return "warning";
  return "critical";
}

function toneText(tone: Tone): string {
  switch (tone) {
    case "healthy":
      return "text-emerald-600";
    case "warning":
      return "text-amber-600";
    case "critical":
      return "text-rose-600";
    default:
      return "text-ink";
  }
}

function toneDot(tone: Tone): string {
  switch (tone) {
    case "healthy":
      return "bg-emerald-500";
    case "warning":
      return "bg-amber-500";
    case "critical":
      return "bg-rose-500";
    default:
      return "bg-ink-muted";
  }
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function formatNumber(value: number | undefined | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "—";
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const KIND_ORDER: RequestKind[] = ["image", "api", "page", "static"];

function kindLabel(kind: RequestKind, t: Translate): string {
  switch (kind) {
    case "image":
      return t("access_diagnostics_kind_image");
    case "api":
      return t("access_diagnostics_kind_api");
    case "page":
      return t("access_diagnostics_kind_page");
    case "static":
      return t("access_diagnostics_kind_static");
    default:
      return t("access_diagnostics_kind_other");
  }
}

function imageKindLabel(kind: string | null, t: Translate): string | null {
  switch (imageKind(kind)) {
    case "main":
      return t("access_diagnostics_kind_main");
    case "option":
      return t("access_diagnostics_kind_option");
    case "variant":
      return t("access_diagnostics_kind_variant");
    case "scene":
      return t("access_diagnostics_kind_scene");
    case "detail":
      return t("access_diagnostics_kind_detail");
    default:
      return null;
  }
}

function trafficLabel(traffic: AdminAccessSlowRequest["traffic"], t: Translate): string {
  if (traffic === "bot") return t("access_diagnostics_traffic_bot");
  if (traffic === "warmup") return t("access_diagnostics_traffic_warmup");
  return t("access_diagnostics_traffic_human");
}

function StatusBanner({
  verdict,
  title,
  reasons,
}: {
  verdict: "ok" | "attention" | "critical";
  title: string;
  reasons: string[];
}) {
  const tone: Tone =
    verdict === "critical" ? "critical" : verdict === "attention" ? "warning" : "healthy";
  const border =
    verdict === "critical"
      ? "border-rose-200 bg-rose-50"
      : verdict === "attention"
        ? "border-amber-200 bg-amber-50"
        : "border-emerald-200 bg-emerald-50";
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${border}`}>
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${toneDot(tone)}`} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {reasons.length > 0 ? (
          <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
            {reasons.join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  suffix,
  hint,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint: string;
  tone: Tone;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold leading-none tabular-nums ${toneText(tone)}`}>
        {value}
        {suffix ? (
          <span className="ml-1 text-sm font-normal text-ink-muted">{suffix}</span>
        ) : null}
      </p>
      <p className="mt-2 text-xs leading-5 text-ink-muted">{hint}</p>
    </div>
  );
}

function Donut({
  rate,
  label,
  tone,
}: {
  rate: number | null;
  label: string;
  tone: Tone;
}) {
  const value = rate ?? 0;
  const ratio = value / 100;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const stroke =
    tone === "healthy" ? "#059669" : tone === "warning" ? "#d97706" : "#e11d48";
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="132" height="132" viewBox="0 0 100 100" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-border, #e5e7eb)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="48" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[18px] font-semibold">
          {rate === null ? "—" : `${Math.round(value)}%`}
        </text>
        <text x="50" y="63" textAnchor="middle" dominantBaseline="central" className="fill-ink-muted text-[8px]">
          {label}
        </text>
      </svg>
    </div>
  );
}

export function AccessDiagnosticsView({
  data,
  error,
  loading,
  onRefresh,
  t,
}: {
  data: AdminAccessReport | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  t: Translate;
}) {
  const [kindFilter, setKindFilter] = useState<RequestKind | "all">("all");
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [errorDetail, setErrorDetail] = useState<number | null>(null);

  const slow = useMemo(
    () =>
      (data?.slowest ?? []).map((entry) => ({
        ...entry,
        parsed: parseRequest(entry.uri),
      })),
    [data],
  );

  if (error) {
    return (
      <div className="mt-5 rounded-xl border border-border bg-card px-4 py-6 text-sm text-ink-muted">
        {error === "unavailable" ? t("access_diagnostics_unavailable") : error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-5 rounded-xl border border-border bg-card px-4 py-6 text-sm text-ink-muted">
        {loading ? "…" : t("access_diagnostics_unavailable")}
      </div>
    );
  }

  const status = overallStatus(data);
  const cache = cacheState(data);
  const cacheTone = toneCache(cache);
  const cacheLabel =
    cache === "normal"
      ? t("access_diagnostics_cache_normal")
      : cache === "warming"
        ? t("access_diagnostics_cache_warming")
        : cache === "below_target"
          ? t("access_diagnostics_cache_below")
          : cache === "failed"
            ? t("access_diagnostics_cache_failed")
            : t("access_diagnostics_cache_unknown");

  const statusTitle =
    status.verdict === "critical"
      ? t("access_diagnostics_status_critical")
      : status.verdict === "attention"
        ? t("access_diagnostics_status_attention")
        : t("access_diagnostics_status_ok");

  const realRate = data.images.realHitRate ?? data.images.hitRate ?? 0;
  const statusReasons = status.reasons.map((reason) => {
    if (reason === "server_errors") {
      return t("access_diagnostics_reason_server_errors", { count: data.status5xx });
    }
    if (reason === "cache_state") {
      if (cache === "warming") {
        return t("access_diagnostics_reason_cache_warming", { rate: realRate });
      }
      if (cache === "failed") {
        return t("access_diagnostics_reason_cache_failed", { rate: realRate });
      }
      return t("access_diagnostics_reason_cache_below", { rate: realRate });
    }
    const rate =
      data.requests > 0
        ? Math.round((data.status4xx / data.requests) * 1000) / 10
        : 0;
    return t("access_diagnostics_reason_4xx_high", { rate });
  });

  const rate4xx =
    data.requests > 0
      ? Math.round((data.status4xx / data.requests) * 1000) / 10
      : null;

  const filteredSlow =
    kindFilter === "all"
      ? slow
      : slow.filter((entry) => entry.parsed.kind === kindFilter);

  const windowRange =
    data.windowFirstAt && data.windowLastAt
      ? t("access_diagnostics_window_range", {
          from: formatTime(data.windowFirstAt),
          to: formatTime(data.windowLastAt),
        })
      : null;

  return (
    <div className="mt-5 space-y-6">
      <StatusBanner verdict={status.verdict} title={statusTitle} reasons={statusReasons} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="space-x-2">
          <span>{t("access_diagnostics_window", { count: formatNumber(data.windowLines) })}</span>
          {windowRange ? <span>· {windowRange}</span> : null}
          <span>
            ·{" "}
            {t("access_diagnostics_generated_at", {
              time: new Date(data.generatedAt).toLocaleString(),
            })}
          </span>
        </span>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          {t("access_diagnostics_refresh")}
        </Button>
      </div>

      {data.stale ? (
        <p className="-mt-3 text-xs font-medium text-amber-600">
          {t("access_diagnostics_stale")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={t("access_diagnostics_requests")}
          value={formatNumber(data.requests)}
          hint={t("access_diagnostics_kpi_hint_requests")}
          tone="unknown"
        />
        <Kpi
          label={t("access_diagnostics_5xx")}
          value={formatNumber(data.status5xx)}
          suffix={`(${percent(data.errorRate5xx)})`}
          hint={t("access_diagnostics_kpi_hint_5xx")}
          tone={tone5xx(data.errorRate5xx)}
        />
        <Kpi
          label={t("access_diagnostics_4xx")}
          value={formatNumber(data.status4xx)}
          suffix={`(${percent(rate4xx)})`}
          hint={t("access_diagnostics_kpi_hint_4xx")}
          tone={tone4xx(rate4xx)}
        />
        <Kpi
          label={t("access_diagnostics_image_hit")}
          value={percent(data.images.realHitRate ?? data.images.hitRate)}
          suffix={cacheLabel}
          hint={t("access_diagnostics_kpi_hint_hit")}
          tone={cacheTone}
        />
      </div>

      {/* Image performance */}
      <section className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5 sm:py-5">
        <header>
          <h3 className="text-sm font-semibold text-ink">{t("access_diagnostics_image_title")}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{t("access_diagnostics_image_subtitle")}</p>
        </header>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
          <Donut
            rate={data.images.realHitRate ?? data.images.hitRate}
            label={t("access_diagnostics_image_chart_hit")}
            tone={cacheTone}
          />
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_image_requests")}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{formatNumber(data.images.requests)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_image_chart_hit")}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-emerald-600">
                {formatNumber(data.images.hit)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_image_chart_miss")}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-amber-600">
                {formatNumber(data.images.miss)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_hit_rate")}</dt>
              <dd className={`mt-0.5 font-semibold tabular-nums ${toneText(cacheTone)}`}>
                {percent(data.images.realHitRate ?? data.images.hitRate)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_traffic_warmup")}</dt>
              <dd className="mt-0.5 tabular-nums text-ink-muted">
                {formatNumber(data.images.warmupRequests)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_image_coverage")}</dt>
              <dd className="mt-0.5 text-ink-muted">{t("access_diagnostics_not_wired")}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_image_last_warm")}</dt>
              <dd className="mt-0.5 text-ink-muted">{t("access_diagnostics_not_wired")}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t("access_diagnostics_image_warm_failed")}</dt>
              <dd className="mt-0.5 text-ink-muted">{t("access_diagnostics_not_wired")}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-muted">{t("access_diagnostics_hit_hint")}</p>
      </section>

      {/* Error breakdown */}
      <section className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5 sm:py-5">
        <header>
          <h3 className="text-sm font-semibold text-ink">{t("access_diagnostics_errors_title")}</h3>
          <p className="mt-0.5 text-xs leading-5 text-ink-muted">
            {t("access_diagnostics_errors_note")}
          </p>
        </header>
        {data.errors.length === 0 ? (
          <p className="mt-3 text-sm text-emerald-600">{t("access_diagnostics_errors_none")}</p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-muted">
                    <th className="whitespace-nowrap py-2 pr-4 font-medium">
                      {t("access_diagnostics_error_code")}
                    </th>
                    <th className="w-full py-2 pr-4 font-medium">
                      {t("access_diagnostics_col_resource")}
                    </th>
                    <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">
                      {t("access_diagnostics_error_count")}
                    </th>
                    <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">
                      {t("access_diagnostics_error_last")}
                    </th>
                    <th className="whitespace-nowrap py-2 font-medium">
                      {t("access_diagnostics_error_verdict")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((row, index) => {
                    const open = errorDetail === index;
                    const tone: Tone = row.bot ? "unknown" : row.code >= 500 ? "critical" : "warning";
                    return (
                      <Fragment key={`${row.code}-${row.path}-${index}`}>
                        <tr
                          onClick={() => setErrorDetail(open ? null : index)}
                          className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-primary-light/40"
                        >
                          <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs">{row.code}</td>
                          <td className="max-w-[22rem] truncate py-2 pr-4" title={row.path}>
                            {row.path}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                            {formatNumber(row.count)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-right text-xs text-ink-muted">
                            {formatTime(row.lastAt)}
                          </td>
                          <td className={`whitespace-nowrap py-2 text-xs font-medium ${toneText(tone)}`}>
                            {row.bot
                              ? t("access_diagnostics_error_bot")
                              : row.code >= 500
                                ? t("access_diagnostics_verdict_server")
                                : t("access_diagnostics_error_human")}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-border/60 bg-primary-light/20 last:border-0">
                            <td colSpan={5} className="px-3 py-3">
                              <ErrorDetail row={row} t={t} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="mt-3 space-y-2 sm:hidden">
              {data.errors.map((row, index) => {
                const open = errorDetail === index;
                return (
                  <li key={`${row.code}-${row.path}-${index}`} className="rounded-lg border border-border/70 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setErrorDetail(open ? null : index)}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        <span className="mr-1 font-mono text-xs text-ink-muted">{row.code}</span>
                        {row.path}
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatNumber(row.count)}
                      </span>
                    </button>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                      <span>{row.bot ? t("access_diagnostics_error_bot") : t("access_diagnostics_error_human")}</span>
                      <span aria-hidden>·</span>
                      <span>{formatTime(row.lastAt)}</span>
                    </p>
                    {open ? (
                      <div className="mt-2 border-t border-border/60 pt-2">
                        <ErrorDetail row={row} t={t} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* Slowest requests */}
      <section className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5 sm:py-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t("access_diagnostics_slow_title")}</h3>
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">
              {t("access_diagnostics_slow_note")}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <FilterChip
              active={kindFilter === "all"}
              onClick={() => {
                setKindFilter("all");
                setDetailIndex(null);
              }}
            >
              {t("access_diagnostics_filter_all")}
            </FilterChip>
            {KIND_ORDER.map((kind) => (
              <FilterChip
                key={kind}
                active={kindFilter === kind}
                onClick={() => {
                  setKindFilter(kind);
                  setDetailIndex(null);
                }}
              >
                {kindLabel(kind, t)}
              </FilterChip>
            ))}
          </div>
        </header>

        {filteredSlow.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">{t("access_diagnostics_no_slow")}</p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-muted">
                    <th className="w-full py-2 pr-4 font-medium">
                      {t("access_diagnostics_col_resource")}
                    </th>
                    <th className="whitespace-nowrap py-2 pr-4 font-medium">
                      {t("access_diagnostics_col_kind")}
                    </th>
                    <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">
                      {t("access_diagnostics_col_duration")}
                    </th>
                    <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">
                      {t("access_diagnostics_col_status")}
                    </th>
                    <th className="whitespace-nowrap py-2 font-medium">
                      {t("access_diagnostics_col_cache")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSlow.map((entry, index) => {
                    const tone = toneDuration(entry.ms);
                    const open = detailIndex === index;
                    const label =
                      entry.image?.productName ??
                      entry.parsed.name;
                    const kindText =
                      imageKindLabel(entry.image?.kind ?? null, t) ??
                      kindLabel(entry.parsed.kind, t);
                    return (
                      <Fragment key={`${entry.uri}-${index}`}>
                        <tr
                          onClick={() => setDetailIndex(open ? null : index)}
                          className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-primary-light/40"
                        >
                          <td className="max-w-[24rem] truncate py-2 pr-4" title={label}>
                            {label}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-xs text-ink-muted">
                            {kindText}
                          </td>
                          <td className={`whitespace-nowrap py-2 pr-4 text-right tabular-nums ${toneText(tone)}`}>
                            {entry.ms}ms
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                            {entry.status}
                          </td>
                          <td className={`whitespace-nowrap py-2 text-xs font-medium ${entry.cache === "HIT" ? "text-emerald-600" : entry.cache === "MISS" ? "text-amber-600" : "text-ink-muted"}`}>
                            {entry.cache}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-border/60 bg-primary-light/20 last:border-0">
                            <td colSpan={5} className="px-3 py-3">
                              <SlowDetail entry={entry} t={t} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="mt-3 space-y-2 sm:hidden">
              {filteredSlow.map((entry, index) => {
                const tone = toneDuration(entry.ms);
                const open = detailIndex === index;
                const label = entry.image?.productName ?? entry.parsed.name;
                const kindText =
                  imageKindLabel(entry.image?.kind ?? null, t) ??
                  kindLabel(entry.parsed.kind, t);
                return (
                  <li key={`${entry.uri}-${index}`} className="rounded-lg border border-border/70 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setDetailIndex(open ? null : index)}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
                      <span className={`shrink-0 text-sm font-medium tabular-nums ${toneText(tone)}`}>
                        {entry.ms}ms
                      </span>
                    </button>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                      <span>{kindText}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{entry.status}</span>
                      <span aria-hidden>·</span>
                      <span className={entry.cache === "HIT" ? "text-emerald-600" : "text-amber-600"}>
                        {entry.cache}
                      </span>
                    </p>
                    {open ? (
                      <div className="mt-2 border-t border-border/60 pt-2">
                        <SlowDetail entry={entry} t={t} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function ErrorDetail({ row, t }: { row: AdminAccessErrorRow; t: Translate }) {
  return (
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_col_resource")}</dt>
        <dd className="mt-0.5 break-all font-mono text-[11px] leading-5">{row.path}</dd>
      </div>
      <div>
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_error_first")}</dt>
        <dd className="mt-0.5 tabular-nums">{formatTime(row.firstAt)}</dd>
      </div>
      <div>
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_error_last")}</dt>
        <dd className="mt-0.5 tabular-nums">{formatTime(row.lastAt)}</dd>
      </div>
      <div>
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_error_repeat")}</dt>
        <dd className="mt-0.5 tabular-nums">{formatNumber(row.count)}</dd>
      </div>
      <div>
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_error_referer")}</dt>
        <dd className="mt-0.5 break-all">{refererPath(row.sampleReferer) ?? "—"}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_error_ua")}</dt>
        <dd className="mt-0.5 break-all font-mono text-[11px] leading-5">{row.sampleUa || "—"}</dd>
      </div>
    </dl>
  );
}

function SlowDetail({
  entry,
  t,
}: {
  entry: AdminAccessSlowRequest & { parsed: ReturnType<typeof parseRequest> };
  t: Translate;
}) {
  return (
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_detail_url")}</dt>
        <dd className="mt-0.5 break-all font-mono text-[11px] leading-5">{entry.uri}</dd>
      </div>
      {entry.image?.width != null ? (
        <div>
          <dt className="font-medium text-ink-muted">{t("access_diagnostics_detail_width")}</dt>
          <dd className="mt-0.5 tabular-nums">{entry.image.width}px</dd>
        </div>
      ) : null}
      <div>
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_col_cache")}</dt>
        <dd className="mt-0.5">{entry.cache}</dd>
      </div>
      <div>
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_from_page")}</dt>
        <dd className="mt-0.5 break-all">{refererPath(entry.referer) ?? "—"}</dd>
      </div>
      <div>
        <dt className="font-medium text-ink-muted">{t("access_diagnostics_col_kind")}</dt>
        <dd className="mt-0.5">{trafficLabel(entry.traffic, t)}</dd>
      </div>
      {entry.image?.productName ? (
        <div className="sm:col-span-2">
          <dt className="font-medium text-ink-muted">{t("access_diagnostics_col_resource")}</dt>
          <dd className="mt-0.5">
            {entry.image.productSlug ? (
              <a
                className="text-cta underline-offset-2 hover:underline"
                href={`/products/${entry.image.productSlug}`}
                target="_blank"
                rel="noreferrer"
              >
                {entry.image.productName}
              </a>
            ) : (
              entry.image.productName
            )}
          </dd>
        </div>
      ) : (
        <div className="sm:col-span-2">
          <dt className="font-medium text-ink-muted">{t("access_diagnostics_col_resource")}</dt>
          <dd className="mt-0.5 text-ink-muted">{t("access_diagnostics_image_unmatched")}</dd>
        </div>
      )}
    </dl>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-cta bg-cta text-cta-foreground"
          : "border-border bg-card text-ink-secondary hover:border-primary"
      }`}
    >
      {children}
    </button>
  );
}
