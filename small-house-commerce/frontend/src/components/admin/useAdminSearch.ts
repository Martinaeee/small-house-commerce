"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, type AdminSearchResponse } from "@/lib/admin-api";
import { flattenAdminSearchResults } from "@/lib/admin-search";

export type AdminSearchStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error";

export type AdminSearchErrorCode = "QUERY_TOO_LONG" | "REQUEST_FAILED";

interface AdminSearchState {
  status: AdminSearchStatus;
  response: AdminSearchResponse | null;
  error: AdminSearchErrorCode | null;
}

export interface UseAdminSearchResult extends AdminSearchState {
  retry(): void;
}

const IDLE_STATE: AdminSearchState = {
  status: "idle",
  response: null,
  error: null,
};

function initialState(enabled: boolean, length: number): AdminSearchState {
  if (enabled && length > 100) {
    return {
      status: "error",
      response: null,
      error: "QUERY_TOO_LONG",
    };
  }
  return IDLE_STATE;
}

export function useAdminSearch(
  query: string,
  options: { enabled: boolean; limit: number; debounceMs?: number },
): UseAdminSearchResult {
  const { enabled, limit, debounceMs = 250 } = options;
  const normalized = query.trim().replace(/\s+/g, " ");
  const length = [...normalized].length;
  const requestId = useRef(0);
  const [retryKey, setRetryKey] = useState(0);
  const identity = `${enabled ? "1" : "0"}\u0000${normalized}\u0000${limit}\u0000${debounceMs}\u0000${retryKey}`;
  const [stateIdentity, setStateIdentity] = useState(identity);
  const [state, setState] = useState<AdminSearchState>(() =>
    initialState(enabled, length),
  );

  if (stateIdentity !== identity) {
    setStateIdentity(identity);
    setState(initialState(enabled, length));
  }

  useEffect(() => {
    const id = ++requestId.current;

    if (!enabled || length < 2 || length > 100) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ status: "loading", response: null, error: null });
      void adminApi
        .searchAdmin({ q: normalized, limit, signal: controller.signal })
        .then((response) => {
          if (id !== requestId.current || controller.signal.aborted) return;
          const empty = flattenAdminSearchResults(response).length === 0;
          setState({
            status: empty ? "empty" : "success",
            response,
            error: null,
          });
        })
        .catch((error: unknown) => {
          if (
            id !== requestId.current ||
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            return;
          }
          setState({
            status: "error",
            response: null,
            error: "REQUEST_FAILED",
          });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, length, enabled, limit, debounceMs, retryKey]);

  const retry = useCallback(() => {
    setRetryKey((current) => current + 1);
  }, []);

  return { ...state, retry };
}
