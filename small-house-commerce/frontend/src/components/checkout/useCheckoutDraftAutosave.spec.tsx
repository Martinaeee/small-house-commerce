import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
