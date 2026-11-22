"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { HealthHomeView } from "@/components/admin/observability/HealthHomeView";
import { adminApi, type AdminAlertList, type AdminAvailabilityReport, type AdminStorefrontHealth } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

/** Storefront Health home (P1R shell). */
export default function StorefrontHealthPage() {
  const { t } = useAdminI18n();
  const [data, setData] = useState<AdminStorefrontHealth | null>(null);
  const [availability, setAvailability] = useState<AdminAvailabilityReport | null>(null);
  const [alerts, setAlerts] = useState<AdminAlertList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [health, probes, alertsData] = await Promise.all([
        adminApi.storefrontHealth(),
        adminApi.storefrontAvailability().catch(() => null),
        adminApi.storefrontAlerts().catch(() => null),
      ]);
      setData(health);
      setAvailability(probes);
      setAlerts(alertsData);
      setError(null);
    } catch (cause) {
      setError(errorStatus(cause) === 403 ? "forbidden" : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader title={t("observability_title")} subtitle={t("health_page_subtitle")} />
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-admin-border px-2.5 py-1.5 text-xs font-medium text-admin-ink hover:bg-admin-muted/10 disabled:opacity-60"
        >
          {loading ? "…" : t("health_refresh")}
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error === "forbidden" ? t("health_forbidden") : error}
        </p>
      )}
      {loading && !data ? (
        <p className="text-sm text-admin-muted">{t("health_loading")}</p>
      ) : data ? (
        <HealthHomeView data={data} availability={availability} alerts={alerts} t={t} />
      ) : null}
    </div>
  );
}
