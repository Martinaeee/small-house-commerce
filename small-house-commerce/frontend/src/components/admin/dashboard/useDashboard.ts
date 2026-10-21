"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import {
  dashboardApi,
  type DashboardMarketing,
  type DashboardOverview,
  type DashboardProducts,
  type DashboardQuery,
  type ProductPerformanceSort,
} from "@/lib/dashboard-api";

export interface DashboardErrors {
  overview: string | null;
  products: string | null;
  marketing: string | null;
}

export interface DashboardState {
  overview: DashboardOverview | null;
  products: DashboardProducts | null;
  marketing: DashboardMarketing | null;
  loading: boolean;
  errors: DashboardErrors;
  reload: () => void;
}

interface Loaded<T> {
  key: string;
  data: T | null;
  error: string | null;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Request failed";
}

/**
 * Loads the three dashboard groups in parallel.
 *
 * The groups are independent on purpose: if the campaign report is slow or
 * broken, sales and inventory still render. The response key gates staleness
 * so a range change never shows the previous period's numbers, and a marker
 * object drops out-of-order responses.
 *
 * The product table's ranking is a separate key: changing the sort re-reads
 * the product group only, instead of re-reading sales and campaigns for a
 * result they do not depend on.
 */
export function useDashboard(
  query: DashboardQuery | null,
  sort: ProductPerformanceSort = "revenue",
): DashboardState {
  const { admin } = useAdminAuth();
  const [epoch, setEpoch] = useState(0);
  const [overviewState, setOverviewState] = useState<Loaded<DashboardOverview> | null>(null);
  const [productsState, setProductsState] = useState<Loaded<DashboardProducts> | null>(null);
  const [marketingState, setMarketingState] = useState<Loaded<DashboardMarketing> | null>(null);
  // One marker per effect: the two groups load independently, so they must
  // not cancel each other's in-flight response.
  const overviewMarker = useRef<object | null>(null);
  const productsMarker = useRef<object | null>(null);

  const actorKey = JSON.stringify([admin?.id, admin?.permissions]);
  // The admin object identity changes on every render; the boolean does not.
  // Permission changes are already covered by `actorKey` inside `key`.
  const hasAdmin = Boolean(admin);
  const key = query ? JSON.stringify([actorKey, query]) : null;
  const productKey = key ? JSON.stringify([key, sort]) : null;

  useEffect(() => {
    if (!hasAdmin || !query || !key) return;
    const marker = {};
    overviewMarker.current = marker;

    void Promise.allSettled([
      dashboardApi.overview(query),
      dashboardApi.marketing(query),
    ]).then(([overview, marketing]) => {
      if (overviewMarker.current !== marker) return;
      setOverviewState({
        key,
        data: overview.status === "fulfilled" ? overview.value : null,
        error: overview.status === "rejected" ? message(overview.reason) : null,
      });
      setMarketingState({
        key,
        data: marketing.status === "fulfilled" ? marketing.value : null,
        error: marketing.status === "rejected" ? message(marketing.reason) : null,
      });
    });

    return () => {
      if (overviewMarker.current === marker) overviewMarker.current = null;
    };
  }, [hasAdmin, key, epoch, query]);

  useEffect(() => {
    if (!hasAdmin || !query || !productKey) return;
    const marker = {};
    productsMarker.current = marker;

    void dashboardApi.products({ ...query, sort }).then(
      (products) => {
        if (productsMarker.current !== marker) return;
        setProductsState({ key: productKey, data: products, error: null });
      },
      (reason: unknown) => {
        if (productsMarker.current !== marker) return;
        setProductsState({ key: productKey, data: null, error: message(reason) });
      },
    );

    return () => {
      if (productsMarker.current === marker) productsMarker.current = null;
    };
  }, [hasAdmin, productKey, epoch, query, sort]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  const overview = overviewState?.key === key ? overviewState.data : null;
  const products = productsState?.key === productKey ? productsState.data : null;
  const marketing = marketingState?.key === key ? marketingState.data : null;

  return {
    overview,
    products,
    marketing,
    loading:
      Boolean(admin) &&
      key !== null &&
      (overviewState?.key !== key ||
        productsState?.key !== productKey ||
        marketingState?.key !== key),
    errors: {
      overview: overviewState?.key === key ? overviewState.error : null,
      products: productsState?.key === productKey ? productsState.error : null,
      marketing: marketingState?.key === key ? marketingState.error : null,
    },
    reload,
  };
}
