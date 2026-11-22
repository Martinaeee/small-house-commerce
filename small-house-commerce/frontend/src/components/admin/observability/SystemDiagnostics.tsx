"use client";

import type { AdminI18n } from "@/lib/admin-i18n";
import type { AdminTelemetryActivity } from "@/lib/admin-api";

/**
 * System diagnostics (collapsed by default). Telemetry Activity is a fact
 * sheet, never a health verdict: the disclaimer is always shown and missing
 * data renders UNKNOWN.
 */
export function SystemDiagnostics({
  telemetry,
  t,
}: {
  telemetry: AdminTelemetryActivity | undefined;
  t: AdminI18n["t"];
}) {
  return (
    <details className="rounded-xl border border-admin-border bg-white" data-testid="system-diagnostics">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-admin-ink">
        {t("health_system_diagnostics")}
      </summary>
      <div className="border-t border-admin-border p-4">
        <p className="text-xs font-medium text-admin-muted">{t("health_telemetry_title")}</p>
        {telemetry?.state === "VALUE" ? (
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-admin-muted">{t("health_telemetry_last_event")}</dt>
              <dd className="font-medium">
                {telemetry.lastEventAt ? new Date(telemetry.lastEventAt).toLocaleString() : "UNKNOWN"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-admin-muted">{t("health_telemetry_events24h")}</dt>
              <dd className="font-medium">{telemetry.events24h ?? "UNKNOWN"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-admin-muted">{t("health_telemetry_source")}</dt>
              <dd className="font-medium">
                {telemetry.sources && telemetry.sources.length > 0 ? telemetry.sources.join(", ") : "UNKNOWN"}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            <p className="font-semibold text-admin-ink">UNKNOWN</p>
            {telemetry?.note ? <p className="text-xs text-admin-muted">{telemetry.note}</p> : null}
          </div>
        )}
        <p className="mt-3 border-t border-admin-border pt-2 text-[11px] text-admin-muted">
          {t("health_telemetry_disclaimer")}
        </p>
      </div>
    </details>
  );
}
