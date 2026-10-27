"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SystemStatusView } from "@/components/admin/system-status/SystemStatusView";
import { Button } from "@/components/ui/Button";
import { adminApi, type AdminSystemStatus } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

export default function SystemStatusPage() {
  const { t } = useAdminI18n();
  const [data, setData] = useState<AdminSystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminApi.systemStatus());
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
        title={t("system_status_title")}
        subtitle={t("system_status_subtitle")}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {t("system_status_refresh")}
          </Button>
        }
      />

      {data ? (
        <p className="mt-2 text-xs text-ink-muted">
          {t("system_status_generated_at", {
            time: new Date(data.generatedAt).toLocaleString(),
          })}
        </p>
      ) : null}

      <div className="mt-5">
        <SystemStatusView
          data={data}
          error={error}
          loading={loading}
          onRefresh={() => void load()}
          t={t}
        />
      </div>
    </div>
  );
}
