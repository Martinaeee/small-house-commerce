"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { AccessDiagnosticsView } from "@/components/admin/system-status/AccessDiagnosticsView";
import { adminApi, type AdminAccessReport } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function AccessDiagnosticsPage() {
  const { t } = useAdminI18n();
  const [data, setData] = useState<AdminAccessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminApi.systemAccess());
      setError(null);
    } catch (cause) {
      setError(errorStatus(cause) === 503 ? "unavailable" : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer the first load so the effect body does not synchronously set state.
    const initial = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader
        title={t("access_diagnostics_title")}
        subtitle={t("access_diagnostics_subtitle")}
      />
      <AccessDiagnosticsView
        data={data}
        error={error}
        loading={loading}
        onRefresh={() => void load()}
        t={t}
      />
    </div>
  );
}
