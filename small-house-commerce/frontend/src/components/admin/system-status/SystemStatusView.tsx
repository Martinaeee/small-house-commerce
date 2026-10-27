"use client";

import type { ReactNode } from "react";
import type { AdminSystemStatus } from "@/lib/admin-api";
import type { TKey } from "@/lib/admin-i18n";

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;
type Tone = "healthy" | "warning" | "critical" | "unknown";

function toneClass(tone: Tone): string {
  switch (tone) {
    case "healthy":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "critical":
      return "border-rose-200 bg-rose-50 text-rose-900";
    default:
      return "border-border bg-card text-ink";
  }
}

function toneBadge(tone: Tone, t: Translate): string {
  switch (tone) {
    case "healthy":
      return t("system_status_healthy");
    case "warning":
      return t("system_status_warning");
    case "critical":
      return t("system_status_critical");
    default:
      return t("system_status_unknown");
  }
}

function bytes(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const OPENSSL_MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// Manila is a fixed +08:00 offset with no daylight saving.
const MANILA_OFFSET_MINUTES = 8 * 60;

/**
 * Parses the openssl `-enddate` format, e.g. "Jan 22 04:59:59 2027 GMT".
 * Returns null for anything else so the caller can fall back to the raw value.
 */
function parseOpensslDate(value: string): Date | null {
  const match = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/.exec(
    value.trim(),
  );
  if (!match) return null;
  const month = OPENSSL_MONTHS[match[1]];
  if (month === undefined) return null;
  const [, , day, hour, minute, second, year] = match;
  return new Date(
    Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)),
  );
}

/** Formats the expiry as Manila wall-clock time so the operator can act on it. */
function formatExpiry(notAfter?: string): string {
  if (!notAfter) return "—";
  const parsed = parseOpensslDate(notAfter);
  if (!parsed) return notAfter;
  const shifted = new Date(parsed.getTime() + MANILA_OFFSET_MINUTES * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())} (GMT+8)`
  );
}

function Card({
  title,
  tone,
  children,
  t,
}: {
  title: string;
  tone: Tone;
  children: ReactNode;
  t: Translate;
}): ReactNode {
  return (
    <section
      className={`rounded-xl border p-4 shadow-sm ${toneClass(tone)}`}
      data-tone={tone}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold">
          {toneBadge(tone, t)}
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs opacity-70">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

export function SystemStatusView({
  data,
  error,
  loading,
  onRefresh,
  t,
}: {
  data: AdminSystemStatus | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  t: Translate;
}): ReactNode {
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900"
      >
        <p className="font-semibold">
          {error === "unavailable"
            ? t("system_status_unavailable")
            : `${t("system_status_not_available")}: ${error}`}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-100"
        >
          {t("system_status_refresh")}
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-ink-muted">
        {loading ? "…" : t("system_status_not_available")}
      </div>
    );
  }

  const cert = data.certificate;
  // The served certificate is what browsers get; the on-disk file is the
  // fallback. Whichever expires first drives both the countdown and the red
  // state, so the card can never look calm while a certificate is about to die.
  const fileDays = cert?.daysRemaining;
  const servedDays = cert?.served?.daysRemaining;
  const useServed =
    typeof servedDays === "number" &&
    (typeof fileDays !== "number" || servedDays <= fileDays);
  const certDays = useServed ? servedDays : (fileDays ?? servedDays);
  const certExpiry = useServed
    ? (cert?.served?.notAfter ?? cert?.notAfter)
    : (cert?.notAfter ?? cert?.served?.notAfter);
  const certTone: Tone =
    cert?.keyMatches === false || cert?.served?.reachable === false
      ? "critical"
      : typeof certDays === "number" && certDays <= 7
        ? "critical"
        : typeof certDays === "number" && certDays <= 30
          ? "warning"
          : "healthy";

  const services = data.services ?? [];
  const servicesTone: Tone = services.some((s) => s.status !== "running")
    ? "critical"
    : "healthy";

  const usedPercent = data.disk?.usedPercent;
  const diskTone: Tone =
    typeof usedPercent === "number" && usedPercent >= 90
      ? "critical"
      : typeof usedPercent === "number" && usedPercent >= 80
        ? "warning"
        : "healthy";

  const backupHours = data.backup?.ageHours;
  const backupTone: Tone =
    backupHours === null || backupHours === undefined
      ? "critical"
      : backupHours > 24
        ? "warning"
        : "healthy";

  return (
    <div className="space-y-4">
      {data.stale ? (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900"
        >
          {t("system_status_stale")}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title={t("system_status_certificate")} tone={certTone} t={t}>
          <Row
            label={t("system_status_days_left", { days: certDays ?? "—" })}
            value={cert?.subject ?? "—"}
          />
          <Row label={t("system_status_expires_at")} value={formatExpiry(certExpiry)} />
          <Row label="SAN" value={(cert?.san ?? []).join(", ") || "—"} />
          <Row
            label={t("system_status_healthy")}
            value={cert?.keyMatches === false ? t("system_status_critical") : t("system_status_healthy")}
          />
          <Row
            label="TLS"
            value={cert?.served?.reachable === false ? t("system_status_critical") : t("system_status_healthy")}
          />
        </Card>

        <Card title={t("system_status_services")} tone={servicesTone} t={t}>
          {services.length === 0 ? (
            <Row label="—" value={t("system_status_unknown")} />
          ) : (
            services.map((service) => (
              <Row
                key={service.name}
                label={service.name}
                value={`${service.status} · ${t("system_status_restarts", { count: service.restarts })}`}
              />
            ))
          )}
        </Card>

        <Card title={t("system_status_disk")} tone={diskTone} t={t}>
          <Row
            label={t("system_status_disk")}
            value={`${usedPercent ?? "—"}%`}
          />
          <Row
            label="可用"
            value={bytes(data.disk?.availableBytes)}
          />
          <Row label="总量" value={bytes(data.disk?.totalBytes)} />
        </Card>

        <Card title={t("system_status_backup")} tone={backupTone} t={t}>
          <Row
            label={t("system_status_backup")}
            value={
              backupHours === null || backupHours === undefined
                ? t("system_status_no_backup")
                : t("system_status_backup_age", { hours: backupHours })
            }
          />
          <Row label="文件" value={data.backup?.latestFile ?? "—"} />
        </Card>

        <Card
          title={t("system_status_database")}
          tone={data.database?.reachable === false ? "critical" : "healthy"}
          t={t}
        >
          <Row label={t("system_status_database")} value={data.database?.sizePretty ?? "—"} />
          <Row
            label={t("system_status_migrations", { count: data.database?.migrations ?? "—" })}
            value={data.database?.reachable === false ? t("system_status_critical") : t("system_status_healthy")}
          />
        </Card>

        <Card title={t("system_status_media")} tone="healthy" t={t}>
          <Row
            label={t("system_status_files", { count: data.uploads?.files ?? "—" })}
            value={data.uploads?.pretty ?? "—"}
          />
        </Card>

        <Card
          title={t("system_status_alert")}
          tone={data.alert?.lastResult ? "healthy" : "warning"}
          t={t}
        >
          <Row label={t("system_status_alert")} value={data.alert?.lastResult ?? "—"} />
          <Row label="时间" value={data.alert?.lastCheckAt ?? "—"} />
        </Card>
      </div>
    </div>
  );
}
