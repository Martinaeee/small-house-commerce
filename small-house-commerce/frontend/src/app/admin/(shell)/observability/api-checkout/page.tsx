"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiCheckoutView } from "@/components/admin/observability/ApiCheckoutView";
import {
  adminApi,
  type AdminApiDiagnostics,
  type AdminRequestTrace,
} from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

/** P3 API & Checkout diagnostics. */
export default function ApiCheckoutPage() {
  const { t } = useAdminI18n();
  const [data, setData] = useState<AdminApiDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trace, setTrace] = useState<AdminRequestTrace | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminApi.storefrontApiDiagnostics());
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

  const lookup = useCallback(async (requestId: string) => {
    setTraceLoading(true);
    try {
      setTrace(await adminApi.storefrontRequestTrace(requestId));
      setTraceError(null);
    } catch (cause) {
      setTrace(null);
      setTraceError(errorStatus(cause) === 400 ? "invalid" : errorStatus(cause) === 403 ? "forbidden" : "failed");
    } finally {
      setTraceLoading(false);
    }
  }, []);

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error === "forbidden" ? t("health_forbidden") : error}
        </p>
      )}
      {!error || data ? (
        <ApiCheckoutView
          data={data}
          trace={trace}
          traceError={traceError}
          traceLoading={traceLoading}
          onLookup={(requestId) => void lookup(requestId)}
          onRefresh={() => void load()}
          refreshing={loading}
          t={t}
        />
      ) : null}
    </div>
  );
}
