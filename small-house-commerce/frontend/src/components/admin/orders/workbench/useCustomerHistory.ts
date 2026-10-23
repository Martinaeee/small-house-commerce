"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  type AdminCustomerOrderHistory,
} from "@/lib/admin-api";

interface CustomerHistoryResult {
  /** The phone the data belongs to - a stale answer is never shown. */
  key: string;
  data: AdminCustomerOrderHistory | null;
  error: string | null;
}

/**
 * Every order of one phone number.
 *
 * Three surfaces show it: the customer tab of the drawer, the processing
 * history modal and the customer history modal itself. They all need the same
 * facts, so they share this one call.
 */
export function useCustomerHistory(
  phone: string | null | undefined,
  enabled = true,
): {
  data: AdminCustomerOrderHistory | null;
  loading: boolean;
  error: string | null;
} {
  const [result, setResult] = useState<CustomerHistoryResult | null>(null);
  const key = enabled && phone ? phone : "";

  useEffect(() => {
    if (!key) return;
    let active = true;
    void adminApi
      .customerOrderHistory(key)
      .then((data) => {
        if (active) setResult({ key, data, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setResult({
          key,
          data: null,
          error: err instanceof Error ? err.message : "Request failed.",
        });
      });
    return () => {
      active = false;
    };
  }, [key]);

  const current = result && result.key === key ? result : null;
  return {
    data: current?.data ?? null,
    loading: Boolean(key) && current === null,
    error: current?.error ?? null,
  };
}
