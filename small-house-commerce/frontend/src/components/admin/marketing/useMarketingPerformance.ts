"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import {
  marketingApi,
  type MarketingPerformanceOptions,
  type MarketingPerformanceQuery,
  type MarketingPerformanceReport,
} from "@/lib/marketing-api";

interface ReportState {
  key: string;
  report: MarketingPerformanceReport | null;
  error: string | null;
}

interface OptionsState {
  key: string;
  options: MarketingPerformanceOptions | null;
  error: string | null;
}

export interface UseMarketingPerformanceResult {
  report: MarketingPerformanceReport | null;
  options: MarketingPerformanceOptions | null;
  loading: boolean;
  error: string | null;
  optionsError: string | null;
  reload: () => void;
}

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export function useMarketingPerformance(query: MarketingPerformanceQuery | null): UseMarketingPerformanceResult {
  const { admin } = useAdminAuth();
  const [epoch, setEpoch] = useState(0);
  const [loaded, setLoaded] = useState<ReportState | null>(null);
  const [optionsLoaded, setOptionsLoaded] = useState<OptionsState | null>(null);
  const actorKey = JSON.stringify([admin?.id, admin?.permissions]);
  const reportKey = query ? JSON.stringify([actorKey, query]) : null;
  const reportRequest = useRef<object | null>(null);
  const optionsRequest = useRef<object | null>(null);
  const latest = useRef({ query });

  // The fetch effect keys on reportKey alone; this keeps the payload of the
  // latest render without refetching when a caller passes an equal new object.
  useEffect(() => {
    latest.current.query = query;
  });

  useEffect(() => {
    const request = latest.current.query;
    if (!admin || !reportKey || !request) return;
    const marker = {};
    reportRequest.current = marker;
    marketingApi.performance(request).then(
      (report) => {
        if (reportRequest.current === marker) setLoaded({ key: reportKey, report, error: null });
      },
      (reason: unknown) => {
        if (reportRequest.current === marker) setLoaded({ key: reportKey, report: null, error: message(reason) });
      },
    );
    return () => {
      if (reportRequest.current === marker) reportRequest.current = null;
    };
  }, [admin, actorKey, reportKey, epoch]);

  useEffect(() => {
    if (!admin) return;
    const marker = {};
    optionsRequest.current = marker;
    marketingApi.performanceOptions().then(
      (options) => {
        if (optionsRequest.current === marker) setOptionsLoaded({ key: actorKey, options, error: null });
      },
      (reason: unknown) => {
        if (optionsRequest.current === marker) setOptionsLoaded({ key: actorKey, options: null, error: message(reason) });
      },
    );
    return () => {
      if (optionsRequest.current === marker) optionsRequest.current = null;
    };
  }, [admin, actorKey, epoch]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);

  const currentReport = loaded?.key === reportKey ? loaded : null;
  const currentOptions = optionsLoaded?.key === actorKey ? optionsLoaded : null;

  return {
    report: currentReport?.report ?? null,
    options: currentOptions?.options ?? null,
    loading: Boolean(admin) && reportKey !== null && currentReport === null,
    error: currentReport?.error ?? null,
    optionsError: currentOptions?.error ?? null,
    reload,
  };
}
