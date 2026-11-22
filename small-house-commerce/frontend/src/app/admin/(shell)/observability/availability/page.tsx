"use client";

import { useCallback, useEffect, useState } from "react";
import { AvailabilityView } from "@/components/admin/observability/AvailabilityView";
import {
  adminApi,
  type AdminAvailabilityReport,
  type AdminTelemetryActivity,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

/** Availability: synthetic probes, uptime and edge evidence (P1.5). */
export default function AvailabilityPage() {
  const { t } = useAdminI18n();
  const [data, setData] = useState<AdminAvailabilityReport | null>(null);
  const [telemetry, setTelemetry] = useState<AdminTelemetryActivity | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [availability, health] = await Promise.all([
        adminApi.storefrontAvailability(),
        adminApi.storefrontHealth(),
      ]);
      setData(availability);
      setTelemetry(health.telemetryActivity);
      setError(null);
    } catch (cause) {
      setError(errorStatus(cause) === 403 ? "forbidden" : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <header>
        <h1 className="text-lg font-semibold text-admin-ink">{t("health_section_availability")}</h1>
        <p className="mt-1 text-sm text-admin-muted">{t("health_availability_subtitle")}</p>
      </header>
      <AvailabilityView
        data={data}
        telemetry={telemetry}
        error={error}
        loading={loading}
        onRefresh={() => void load()}
        t={t}
      />
    </div>
  );
}
