"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { AlertsView } from "@/components/admin/observability/AlertsView";
import {
  adminApi,
  type AdminAlertList,
  type AdminAlertStatus,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

/** P2-lite alert issues: PROBE_DOWN / PROBE_STALE / PDP_5XX_TIMEOUT. */
export default function AlertsPage() {
  const { t } = useAdminI18n();
  const { hasPermission } = useAdminAuth();
  const [data, setData] = useState<AdminAlertList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminApi.storefrontAlerts());
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

  const update = useCallback(
    async (id: string, status: AdminAlertStatus) => {
      setUpdatingId(id);
      try {
        await adminApi.updateStorefrontAlert(id, status);
        await load();
      } catch {
        setError(t("alerts_update_failed"));
      } finally {
        setUpdatingId(null);
      }
    },
    [load, t],
  );

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <header>
        <h1 className="text-lg font-semibold text-admin-ink">{t("health_section_issues")}</h1>
        <p className="mt-1 text-sm text-admin-muted">{t("health_alerts_subtitle")}</p>
      </header>
      <AlertsView
        data={data}
        error={error}
        loading={loading}
        canUpdate={hasPermission("SYSTEM_SETTINGS_EDIT")}
        updatingId={updatingId}
        onUpdate={(id, status) => void update(id, status)}
        onRefresh={() => void load()}
        t={t}
      />
    </div>
  );
}
