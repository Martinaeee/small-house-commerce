import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAutosave,
  autosaveStatusLabel,
  resolveCheckoutAttempt,
  type CheckoutAutosaveSnapshot,
} from "@/lib/checkoutAutosave";
import { useCheckoutDraftAutosave } from "./useCheckoutDraftAutosave";

const SNAPSHOT: CheckoutAutosaveSnapshot = {
  customer: {
    name: "",
    phone: "",
    province: "",
    city: "",
    barangay: "",
    postalCode: "",
    streetAddress: "",
    landmark: "",
  },
  items: [{ skuId: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
  preferredDeliveryDate: null,
  promoCodeInput: "",
  promoCodeApplied: null,
  customerNote: "",
};

describe("useCheckoutDraftAutosave", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("saves the draft after the 600ms debounce", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "OPEN", revision: 1 }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const { result } = renderHook(() =>
      useCheckoutDraftAutosave({
        attempt,
        snapshot: SNAPSHOT,
        active: true,
        hasUserInput: false,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("saved");
  });

  it("keeps the user input and marks offline when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const attempt = resolveCheckoutAttempt("cart:all");
    const { result } = renderHook(() =>
      useCheckoutDraftAutosave({
        attempt,
        snapshot: SNAPSHOT,
        active: true,
        hasUserInput: true,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current.status).toBe("offline");
  });

  it("still saves when a render with identical values lands inside the debounce", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "OPEN", revision: 1 }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const { rerender } = renderHook(
      ({ version }: { version: number }) => {
        void version;
        return useCheckoutDraftAutosave({
          attempt,
          // A fresh object with the same values, exactly what a restore
          // landing mid-debounce produces.
          snapshot: { ...SNAPSHOT, customer: { ...SNAPSHOT.customer } },
          active: true,
          hasUserInput: false,
        });
      },
      { initialProps: { version: 0 } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerender({ version: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the latest change after a slower previous request completes", async () => {
    let finish!: (res: Response) => void;
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{"status":"OPEN"}', { status: 200 })),
    ).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const { rerender, result } = renderHook(({ name }) => useCheckoutDraftAutosave({
      attempt, snapshot: { ...SNAPSHOT, customer: { ...SNAPSHOT.customer, name } },
      active: true, hasUserInput: true,
    }), { initialProps: { name: "Ma" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    rerender({ name: "Maria" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(new Response('{"status":"OPEN"}', { status: 200 }));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(body.customer.name).toBe("Maria");
    expect(result.current.status).toBe("saved");
  });

  it("does not claim saved on a revision conflict and advances the next edit", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{"status":"OPEN"}', { status: 200 })),
    ).mockResolvedValueOnce(new Response('{"currentRevision":8}', { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const { rerender, result } = renderHook(({ name }) => useCheckoutDraftAutosave({
      attempt, snapshot: { ...SNAPSHOT, customer: { ...SNAPSHOT.customer, name } },
      active: true, hasUserInput: true,
    }), { initialProps: { name: "Ma" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.status).toBe("conflict");
    expect(autosaveStatusLabel(result.current.status)).toMatch(/another tab/i);
    rerender({ name: "Maria" });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).revision).toBeGreaterThan(8);
  });

  it("does not retry after the checkout unmounts", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const view = renderHook(() => useCheckoutDraftAutosave({
      attempt, snapshot: SNAPSHOT, active: true, hasUserInput: true,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respects Retry-After when the shop rate limits autosave", async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    renderHook(() => useCheckoutDraftAutosave({ attempt, snapshot: SNAPSHOT, active: true, hasUserInput: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps local edits without endlessly retrying a permanent 400", async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const { rerender, result } = renderHook(({ note }) => useCheckoutDraftAutosave({
      attempt, snapshot: { ...SNAPSHOT, customerNote: note }, active: true, hasUserInput: true,
    }), { initialProps: { note: "first" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    rerender({ note: "keep this locally" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readAutosave(attempt)?.snapshot.customerNote).toBe("keep this locally");
    expect(result.current.status).toBe("unavailable");
  });

  it("stops syncing after 410", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 410 }));
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const { result, rerender } = renderHook(
      ({ name }: { name: string }) =>
        useCheckoutDraftAutosave({
          attempt,
          snapshot: { ...SNAPSHOT, customer: { ...SNAPSHOT.customer, name } },
          active: true,
          hasUserInput: true,
        }),
      { initialProps: { name: "" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current.status).toBe("expired");
    const callsAfterStop = fetchMock.mock.calls.length;
    rerender({ name: "Ana" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(fetchMock.mock.calls.length).toBe(callsAfterStop);
    expect(result.current.status).toBe("expired");
  });

  it("stops syncing when the draft was converted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "CONVERTED", revision: 4 }), {
            status: 200,
          }),
      ),
    );
    const attempt = resolveCheckoutAttempt("cart:all");
    const { result } = renderHook(() =>
      useCheckoutDraftAutosave({
        attempt,
        snapshot: SNAPSHOT,
        active: true,
        hasUserInput: true,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current.status).toBe("converted");
  });
});
