"use client";

import { Button } from "@/components/ui/Button";
import type { AdminAccessReport } from "@/lib/admin-api";
import type { TKey } from "@/lib/admin-i18n";

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;
type Tone = "healthy" | "warning" | "critical" | "unknown";

/** 0% is the only healthy 5xx rate; 0.5% is where it stops being noise. */
function tone5xx(rate: number | null): Tone {
  if (rate === null) return "unknown";
  if (rate === 0) return "healthy";
  if (rate < 0.5) return "warning";
  return "critical";
}

/** Below 5% 4xx is normal traffic noise (bots, stale links). */
function tone4xx(rate: number | null): Tone {
  if (rate === null) return "unknown";
  if (rate < 2) return "healthy";
  if (rate < 5) return "warning";
  return "critical";
}

/** A warm optimizer cache should serve nearly everything from disk. */
function toneHitRate(rate: number | null): Tone {
  if (rate === null) return "unknown";
  if (rate >= 90) return "healthy";
  if (rate >= 50) return "warning";
  return "critical";
}

function toneDuration(ms: number): Tone {
  if (ms < 1500) return "healthy";
  if (ms < 3000) return "warning";
  return "critical";
}

function toneText(tone: Tone): string {
  switch (tone) {
    case "healthy":
      return "text-emerald-700";
    case "warning":
      return "text-amber-700";
    case "critical":
      return "text-rose-700";
    default:
      return "text-ink";
  }
}

function toneRow(tone: Tone): string {
  switch (tone) {
    case "healthy":
      return "bg-emerald-50/60";
    case "warning":
      return "bg-amber-50/60";
    case "critical":
      return "bg-rose-50/60";
    default:
      return "";
  }
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function Stat({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone: Tone;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${toneText(tone)}`}>
        {value}
        {suffix ? (
          <span className="ml-1 text-sm font-normal text-ink-muted">{suffix}</span>
        ) : null}
      </dd>
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
  if (error) {
    return (
      <div className="mt-5 text-sm text-ink-muted">
        {error === "unavailable"
          ? t("access_diagnostics_unavailable")
          : error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-5 text-sm text-ink-muted">
        {loading ? "…" : t("access_diagnostics_unavailable")}
      </div>
    );
  }

  const total = data.requests || 0;
  const rate4xx = total ? Math.round((data.status4xx / total) * 10000) / 100 : null;

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <p className="text-xs text-ink-muted">
          {t("access_diagnostics_window", { count: data.windowLines })}
          {" · "}
          {t("access_diagnostics_generated_at", {
            time: new Date(data.generatedAt).toLocaleString(),
          })}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
        >
          {t("access_diagnostics_refresh")}
        </Button>
      </div>

      {data.stale ? (
        <p className="mt-3 text-xs font-medium text-amber-700">
          {t("access_diagnostics_stale")}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat
          label={t("access_diagnostics_requests")}
          value={total.toLocaleString()}
          tone="unknown"
        />
        <Stat
          label={t("access_diagnostics_5xx")}
          value={data.status5xx.toLocaleString()}
          suffix={`(${percent(data.errorRate5xx)})`}
          tone={tone5xx(data.errorRate5xx)}
        />
        <Stat
          label={t("access_diagnostics_4xx")}
          value={data.status4xx.toLocaleString()}
          suffix={`(${percent(rate4xx)})`}
          tone={tone4xx(rate4xx)}
        />
        <Stat
          label={t("access_diagnostics_image_hit")}
          value={percent(data.images.hitRate)}
          tone={toneHitRate(data.images.hitRate)}
        />
      </dl>

      <section className="mt-7">
        <h3 className="text-sm font-semibold">
          {t("access_diagnostics_5xx_paths")}
        </h3>
        {data.top5xxPaths.length === 0 ? (
          <p className="mt-2 text-sm text-emerald-700">
            {t("access_diagnostics_no_5xx")}
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-muted">
                <th className="py-1.5 pr-3 font-medium">
                  {t("access_diagnostics_path")}
                </th>
                <th className="w-20 py-1.5 text-right font-medium">
                  {t("access_diagnostics_count")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.top5xxPaths.map(([path, count]) => (
                <tr key={path} className={`border-b border-border/60 ${toneRow("critical")}`}>
                  <td className="break-all py-1.5 pr-3 font-mono text-xs">{path}</td>
                  <td className="py-1.5 text-right tabular-nums">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          {t("access_diagnostics_5xx_hint")}
        </p>
      </section>

      <section className="mt-7">
        <h3 className="text-sm font-semibold">
          {t("access_diagnostics_slowest")}
        </h3>
        {data.slowest.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            {t("access_diagnostics_no_slowest")}
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-muted">
                <th className="w-24 py-1.5 pr-3 font-medium">
                  {t("access_diagnostics_duration")}
                </th>
                <th className="w-16 py-1.5 pr-3 font-medium">
                  {t("access_diagnostics_status")}
                </th>
                <th className="py-1.5 font-medium">
                  {t("access_diagnostics_path")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.slowest.map((entry, index) => (
                <tr
                  key={`${entry.uri}-${index}`}
                  className={`border-b border-border/60 ${toneRow(toneDuration(entry.ms))}`}
                >
                  <td className={`py-1.5 pr-3 tabular-nums ${toneText(toneDuration(entry.ms))}`}>
                    {entry.ms}ms
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{entry.status}</td>
                  <td className="break-all py-1.5 font-mono text-xs">{entry.uri}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          {t("access_diagnostics_slow_hint")}
        </p>
      </section>

      <section className="mt-7">
        <h3 className="text-sm font-semibold">
          {t("access_diagnostics_image_cache")}
        </h3>
        <table className="mt-2 w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-border/60">
              <td className="py-1.5 pr-3 text-ink-muted">
                {t("access_diagnostics_image_requests")}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {data.images.requests.toLocaleString()}
              </td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="py-1.5 pr-3 text-ink-muted">
                {t("access_diagnostics_hit")}
              </td>
              <td className="py-1.5 text-right tabular-nums text-emerald-700">
                {data.images.hit.toLocaleString()}
              </td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="py-1.5 pr-3 text-ink-muted">
                {t("access_diagnostics_miss")}
              </td>
              <td className="py-1.5 text-right tabular-nums text-amber-700">
                {data.images.miss.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-ink-muted">
                {t("access_diagnostics_hit_rate")}
              </td>
              <td
                className={`py-1.5 text-right tabular-nums font-semibold ${toneText(
                  toneHitRate(data.images.hitRate),
                )}`}
              >
                {percent(data.images.hitRate)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-muted">
          {t("access_diagnostics_hit_hint")}
        </p>
      </section>
    </div>
  );
}
