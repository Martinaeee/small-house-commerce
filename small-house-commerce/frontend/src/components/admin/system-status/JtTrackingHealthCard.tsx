"use client";

import { useEffect, useState } from "react";
import { adminApi, type AdminJtTrackingStatus } from "@/lib/admin-api";
import type { TKey } from "@/lib/admin-i18n";

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * J&T polling health: whether the credentials are complete, how many shipped
 * boxes are waiting for a scan, and the last failure. The worker is invisible
 * unless this card says otherwise.
 */
export function JtTrackingHealthCard({ t }: { t: Translate }) {
  const [data, setData] = useState<AdminJtTrackingStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await adminApi.jtTrackingStatus();
        if (alive) {
          setData(value);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const tone = failed
    ? "critical"
    : data && !data.enabled
      ? "unknown"
      : data && data.lastFailed > 0
        ? "warning"
        : "healthy";
  const toneClasses: Record<string, string> = {
    healthy: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    critical: "border-rose-200 bg-rose-50 text-rose-900",
    unknown: "border-border bg-card text-ink",
  };

  return (
    <section
      className={`mt-4 rounded-xl border p-4 ${toneClasses[tone]}`}
      aria-label={t("jt_tracking_title")}
    >
      <h2 className="text-sm font-semibold">{t("jt_tracking_title")}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_status")}</dt>
          <dd className="font-medium">
            {data ? (data.enabled ? t("jt_tracking_on") : t("jt_tracking_off")) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_pending")}</dt>
          <dd className="font-medium tabular-nums">{data?.pendingShipments ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_last_run")}</dt>
          <dd className="font-medium">
            {data?.lastTickAt ? new Date(data.lastTickAt).toLocaleString() : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_failed")}</dt>
          <dd className="font-medium tabular-nums">{data?.lastFailed ?? "—"}</dd>
        </div>
      </dl>
      {data?.lastError ? (
        <p className="mt-2 text-[12.5px]">
          {t("jt_tracking_error")}: {data.lastError}
        </p>
      ) : null}
    </section>
  );
}
