"use client";

import { useEffect, useState } from "react";
import { adminApi, type AdminMetaCapiStatus } from "@/lib/admin-api";
import type { TKey } from "@/lib/admin-i18n";

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * Meta Conversions API queue health: whether the server-side channel is
 * configured, how many events wait, and the last failure. Purchases survive
 * outages in this queue, so an operator can see the backlog here.
 */
export function MetaCapiHealthCard({ t }: { t: Translate }) {
  const [data, setData] = useState<AdminMetaCapiStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await adminApi.metaCapiStatus();
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
      : data && data.failed > 0
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
      aria-label={t("meta_capi_title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("meta_capi_title")}</h2>
          <p className="text-xs opacity-80">{t("meta_capi_subtitle")}</p>
        </div>
        <span className="rounded-md border border-current/30 px-2 py-1 text-[11px]">
          {data && !data.enabled
            ? t("meta_capi_disabled")
            : t("meta_capi_enabled")}
        </span>
      </div>

      {failed ? (
        <p className="mt-3 text-xs">{t("meta_capi_load_error")}</p>
      ) : data ? (
        <>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
            <div>
              <dt className="inline opacity-70">{t("meta_capi_pending")}: </dt>
              <dd className="inline font-semibold">{data.pending}</dd>
            </div>
            <div>
              <dt className="inline opacity-70">{t("meta_capi_failed")}: </dt>
              <dd className="inline font-semibold">{data.failed}</dd>
            </div>
            <div>
              <dt className="inline opacity-70">{t("meta_capi_sent_24h")}: </dt>
              <dd className="inline font-semibold">{data.sent24h}</dd>
            </div>
            <div>
              <dt className="inline">
                {data.lastSentAt
                  ? t("meta_capi_last_sent", {
                      time: new Date(data.lastSentAt).toLocaleString(),
                    })
                  : t("meta_capi_never_sent")}
              </dt>
            </div>
          </dl>
          {data.lastError ? (
            <p className="mt-2 break-words text-xs">
              {t("meta_capi_last_error", {
                time: data.lastErrorAt
                  ? new Date(data.lastErrorAt).toLocaleString()
                  : "—",
                message: data.lastError,
              })}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
