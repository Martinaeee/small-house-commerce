"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  parseAdminNotificationsResponse,
  type AdminNotificationsResponse,
} from "@/lib/admin-notifications";

export type AdminNotificationsStatus =
  | "loading"
  | "ready"
  | "empty"
  | "error";

interface AdminNotificationsState {
  status: AdminNotificationsStatus;
  response: AdminNotificationsResponse | null;
}

export interface UseAdminNotificationsResult extends AdminNotificationsState {
  retry(): void;
  refresh(): void;
}

const LOADING_STATE: AdminNotificationsState = {
  status: "loading",
  response: null,
};

export function useAdminNotifications(): UseAdminNotificationsResult {
  const requestId = useRef(0);
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<AdminNotificationsState>(LOADING_STATE);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setState(LOADING_STATE);

    void adminApi
      .notifications(controller.signal)
      .then(parseAdminNotificationsResponse)
      .then((response) => {
        if (id !== requestId.current || controller.signal.aborted) return;
        setState({
          status: response.totalCount === 0 ? "empty" : "ready",
          response,
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
        setState({ status: "error", response: null });
      });

    return () => {
      controller.abort();
    };
  }, [requestKey]);

  const refresh = useCallback(() => {
    setRequestKey((current) => current + 1);
  }, []);

  return { ...state, retry: refresh, refresh };
}
