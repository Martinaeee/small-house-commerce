import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminApi,
  type AdminSearchResponse,
  type OrderSearchHit,
} from "@/lib/admin-api";
import { useAdminSearch } from "./useAdminSearch";

const orderHit: OrderSearchHit = {
  kind: "ORDER",
  orderId: "o1",
  orderNumber: "PH-000001",
  orderStatus: "NEW",
  confirmationStatus: "UNCONFIRMED",
  customerName: "Jane",
  normalizedPhone: "+639171234567",
  createdAt: "2026-09-25T00:00:00.000Z",
  matchedField: "ORDER_NUMBER",
  matchedText: "PH-000001",
};

function response(query: string, empty = false): AdminSearchResponse {
  return {
    query,
    groups: empty
      ? {}
      : { orders: { items: [{ ...orderHit, orderNumber: query }], hasMore: false } },
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

function renderSearchHook(initialQ: string, enabled = true) {
  return renderHook(
    ({ q, active }) =>
      useAdminSearch(q, { enabled: active, limit: 5 }),
    { initialProps: { q: initialQ, active: enabled } },
  );
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function startRequest(
  q: string,
  rerender: (props: { q: string; active: boolean }) => void,
): Promise<void> {
  rerender({ q, active: true });
  await advance(250);
}

describe("useAdminSearch", () => {
  const searchAdmin = vi.spyOn(adminApi, "searchAdmin");

  beforeEach(() => {
    vi.useFakeTimers();
    searchAdmin.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not request below two Unicode characters and debounces exactly 250ms", async () => {
    searchAdmin.mockResolvedValue(response("🪑桌"));
    const { rerender } = renderSearchHook("🪑");

    await advance(500);
    expect(searchAdmin).not.toHaveBeenCalled();

    rerender({ q: "🪑桌", active: true });
    await advance(249);
    expect(searchAdmin).not.toHaveBeenCalled();
    await advance(1);
    expect(searchAdmin).toHaveBeenCalledTimes(1);
    expect(searchAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ q: "🪑桌", limit: 5 }),
    );
  });

  it("aborts the old request and ignores its late success", async () => {
    const first = deferred<AdminSearchResponse>();
    const second = deferred<AdminSearchResponse>();
    searchAdmin
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderSearchHook("old");
    await advance(250);
    await startRequest("new", rerender);

    expect(searchAdmin.mock.calls[0]![0].signal?.aborted).toBe(true);
    await act(async () => {
      second.resolve(response("new"));
      await second.promise;
    });
    await act(async () => {
      first.resolve(response("old"));
      await first.promise;
    });
    expect(result.current).toMatchObject({
      status: "success",
      response: response("new"),
      error: null,
    });
  });

  it("keeps the newer success when an older request rejects late", async () => {
    const first = deferred<AdminSearchResponse>();
    const second = deferred<AdminSearchResponse>();
    searchAdmin
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderSearchHook("old");
    await advance(250);
    await startRequest("new", rerender);

    await act(async () => {
      second.resolve(response("new"));
      await second.promise;
    });
    await act(async () => {
      first.reject(new DOMException("Aborted", "AbortError"));
      await first.promise.catch(() => undefined);
    });
    expect(result.current).toMatchObject({
      status: "success",
      response: response("new"),
      error: null,
    });
  });

  it("rejects more than 100 normalized characters locally without a request", async () => {
    const { result } = renderSearchHook("x".repeat(101));

    expect(result.current).toMatchObject({
      status: "error",
      response: null,
      error: "QUERY_TOO_LONG",
    });
    await advance(500);
    expect(searchAdmin).not.toHaveBeenCalled();
  });

  it("stays idle while disabled and aborts an in-flight request when disabled", async () => {
    const pending = deferred<AdminSearchResponse>();
    searchAdmin.mockReturnValue(pending.promise);
    const { result, rerender } = renderSearchHook("chair");
    await advance(250);
    const signal = searchAdmin.mock.calls[0]![0].signal;

    rerender({ q: "chair", active: false });

    expect(signal?.aborted).toBe(true);
    expect(result.current).toMatchObject({
      status: "idle",
      response: null,
      error: null,
    });
  });

  it("maps an authorized empty response to the empty state", async () => {
    searchAdmin.mockResolvedValue(response("missing", true));
    const { result } = renderSearchHook("missing");

    await advance(250);
    await flushPromises();
    expect(result.current.status).toBe("empty");
    expect(result.current.response).toEqual(response("missing", true));
  });

  it("maps ordinary failures to REQUEST_FAILED and retries only on demand", async () => {
    searchAdmin
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response("chair"));
    const { result } = renderSearchHook("chair");

    await advance(250);
    await flushPromises();
    expect(result.current).toMatchObject({
      status: "error",
      response: null,
      error: "REQUEST_FAILED",
    });
    act(() => result.current.retry());
    await advance(250);
    await flushPromises();
    expect(result.current.status).toBe("success");
    expect(searchAdmin).toHaveBeenCalledTimes(2);
  });

  it("treats AbortError as silent and returns to idle when the query is cleared", async () => {
    const pending = deferred<AdminSearchResponse>();
    searchAdmin.mockReturnValue(pending.promise);
    const { result, rerender } = renderSearchHook("chair");
    await advance(250);

    rerender({ q: "", active: true });
    await act(async () => {
      pending.reject(new DOMException("Aborted", "AbortError"));
      await pending.promise.catch(() => undefined);
    });

    expect(result.current).toMatchObject({
      status: "idle",
      response: null,
      error: null,
    });
  });

  it("does not cache a resolved response after the query is cleared", async () => {
    searchAdmin.mockResolvedValue(response("chair"));
    const { result, rerender } = renderSearchHook("chair");
    await advance(250);
    await flushPromises();
    expect(result.current.status).toBe("success");

    rerender({ q: "", active: true });
    rerender({ q: "chair", active: true });
    await advance(250);
    await flushPromises();

    expect(searchAdmin).toHaveBeenCalledTimes(2);
  });
});
