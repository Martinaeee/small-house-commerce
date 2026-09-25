import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "@/lib/admin-api";
import type { AdminNotificationsResponse } from "@/lib/admin-notifications";
import { useAdminNotifications } from "./useAdminNotifications";

function response(
  count: number,
  kind: "ORDER_UNCONFIRMED" | "PRODUCT_MISSING_MEDIA" =
    "ORDER_UNCONFIRMED",
): AdminNotificationsResponse {
  const href =
    kind === "ORDER_UNCONFIRMED"
      ? "/admin/orders?confirmation=UNCONFIRMED"
      : "/admin/products?attention=missing_media";
  return {
    totalCount: count,
    items: count === 0 ? [] : [{ kind, count, href }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useAdminNotifications", () => {
  const notifications = vi.spyOn(adminApi, "notifications");

  beforeEach(() => {
    notifications.mockReset();
  });

  it("fetches immediately and exposes ready and honest empty states", async () => {
    notifications.mockResolvedValueOnce(response(3));
    const { result } = renderHook(() => useAdminNotifications());

    expect(result.current).toMatchObject({
      status: "loading",
      response: null,
    });
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(notifications.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.response).toEqual(response(3));

    notifications.mockResolvedValueOnce(response(0));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe("empty"));
    expect(result.current.response).toEqual(response(0));
  });

  it("maps request and malformed-payload failures to error and retries on demand", async () => {
    notifications
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ totalCount: 1, items: [] })
      .mockResolvedValueOnce(response(2));
    const { result } = renderHook(() => useAdminNotifications());

    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.response).toBeNull();

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.response).toEqual(response(2));
    expect(notifications).toHaveBeenCalledTimes(3);
  });

  it("refresh aborts the prior request and stale completion cannot replace newer data", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    notifications
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAdminNotifications());
    const firstSignal = notifications.mock.calls[0]![0];

    act(() => result.current.refresh());
    expect(firstSignal?.aborted).toBe(true);
    expect(notifications).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(response(4, "PRODUCT_MISSING_MEDIA"));
      await second.promise;
    });
    await act(async () => {
      first.resolve(response(1));
      await first.promise;
    });

    expect(result.current).toMatchObject({
      status: "ready",
      response: response(4, "PRODUCT_MISSING_MEDIA"),
    });
  });

  it("invalidates the old response as soon as refresh is requested", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    notifications
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAdminNotifications());

    await act(async () => {
      result.current.refresh();
      first.resolve(response(1));
      await first.promise;
    });

    expect(result.current).toMatchObject({
      status: "loading",
      response: null,
    });
    await act(async () => {
      second.resolve(response(2));
      await second.promise;
    });
    expect(result.current).toMatchObject({
      status: "ready",
      response: response(2),
    });
  });

  it("keeps newer success when an older request rejects after refresh", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    notifications
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAdminNotifications());

    act(() => result.current.refresh());
    await act(async () => {
      second.resolve(response(5));
      await second.promise;
    });
    await act(async () => {
      first.reject(new Error("late failure"));
      await first.promise.catch(() => undefined);
    });

    expect(result.current).toMatchObject({
      status: "ready",
      response: response(5),
    });
  });

  it("aborts on unmount and never polls or reuses a resolved cache", async () => {
    const pending = deferred<unknown>();
    notifications.mockReturnValueOnce(pending.promise);
    const first = renderHook(() => useAdminNotifications());
    const signal = notifications.mock.calls[0]![0];

    first.unmount();
    expect(signal?.aborted).toBe(true);

    notifications.mockResolvedValueOnce(response(1));
    const second = renderHook(() => useAdminNotifications());
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(notifications).toHaveBeenCalledTimes(2);
    second.unmount();
  });
});
