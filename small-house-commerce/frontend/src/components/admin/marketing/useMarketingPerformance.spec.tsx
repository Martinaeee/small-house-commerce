import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  marketingApi,
  type MarketingPerformanceOptions,
  type MarketingPerformanceQuery,
  type MarketingPerformanceReport,
} from "@/lib/marketing-api";
import { useMarketingPerformance } from "./useMarketingPerformance";

const auth = vi.hoisted(() => ({ admin: { id: "u1", name: "Operator", permissions: ["MARKETING_VIEW_ALL"] } }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({ useAdminAuth: () => auth }));
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { performance: vi.fn(), performanceOptions: vi.fn() } }));

const queryA: MarketingPerformanceQuery = { view: "PRODUCT", productId: "product-a", preset: "LAST_7_DAYS", interval: "DAY", compare: true, sortBy: "name", sortDirection: "asc", page: 1, pageSize: 20 };
const queryB: MarketingPerformanceQuery = { ...queryA, productId: "product-b" };
const queryC: MarketingPerformanceQuery = { ...queryA, productId: "product-c" };
const options: MarketingPerformanceOptions = { onlyOwn: false, products: [], owners: [] };

function report(productId: string): MarketingPerformanceReport {
  return {
    asOf: "2026-10-13T01:00:00.000Z",
    scope: { view: "PRODUCT", productId, ownerUserId: null, landingPageId: null, effectiveStatus: null, onlyOwn: false },
    overview: { total: 0, byStatus: { DRAFT: 0, LIVE: 0, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [] },
    current: { range: { from: "2026-10-06", to: "2026-10-12" }, registeredLinkCount: 0, totals: null },
    previous: null,
    changes: null,
    page: 1,
    pageSize: 20,
    total: 0,
    rows: [],
    trend: { pageId: null, interval: "DAY", points: [] },
    otherSources: { current: [], previous: null },
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.admin.permissions = ["MARKETING_VIEW_ALL"];
  vi.mocked(marketingApi.performance).mockResolvedValue(report("product-a"));
  vi.mocked(marketingApi.performanceOptions).mockResolvedValue(options);
});

describe("useMarketingPerformance", () => {
  it("keeps the newest result when an older request settles late", async () => {
    const first = deferred<MarketingPerformanceReport>();
    const second = deferred<MarketingPerformanceReport>();
    vi.mocked(marketingApi.performance).mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ query }) => useMarketingPerformance(query), { initialProps: { query: queryA } });
    rerender({ query: queryB });
    await act(async () => {
      second.resolve(report("product-b"));
      await second.promise;
    });
    expect(result.current.report?.scope.productId).toBe("product-b");
    await act(async () => {
      first.resolve(report("product-a"));
      await first.promise;
    });
    expect(result.current.report?.scope.productId).toBe("product-b");
    expect(vi.mocked(marketingApi.performance).mock.calls.map(([query]) => query.productId)).toEqual(["product-a", "product-b"]);
  });

  it("does not let a superseded request end the current loading state", async () => {
    const first = deferred<MarketingPerformanceReport>();
    const second = deferred<MarketingPerformanceReport>();
    const third = deferred<MarketingPerformanceReport>();
    vi.mocked(marketingApi.performance).mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const { result, rerender } = renderHook(({ query }) => useMarketingPerformance(query), { initialProps: { query: queryA } });
    rerender({ query: queryB });
    await act(async () => {
      second.resolve(report("product-b"));
      await second.promise;
    });
    expect(result.current.loading).toBe(false);
    rerender({ query: queryC });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      first.resolve(report("product-a"));
      await first.promise;
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.report).toBeNull();
  });

  it("clears the old report and options the moment the actor loses scope", async () => {
    const second = deferred<MarketingPerformanceReport>();
    vi.mocked(marketingApi.performance).mockReset().mockResolvedValueOnce(report("product-a")).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(() => useMarketingPerformance(queryA));
    await flush();
    expect(result.current.report?.scope.productId).toBe("product-a");
    expect(result.current.options).toEqual(options);
    auth.admin.permissions = ["MARKETING_VIEW_OWN"];
    rerender();
    expect(result.current.report).toBeNull();
    expect(result.current.options).toBeNull();
    expect(vi.mocked(marketingApi.performance)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(marketingApi.performanceOptions)).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(report("product-b"));
      await second.promise;
    });
    expect(result.current.report?.scope.productId).toBe("product-b");
  });

  it("keeps the current report across a language change", async () => {
    const { result } = renderHook(() => useMarketingPerformance(queryA), {
      wrapper: ({ children }: { children: React.ReactNode }) => <AdminI18nProvider>{children}</AdminI18nProvider>,
    });
    await flush();
    expect(result.current.report?.scope.productId).toBe("product-a");
    act(() => setAdminLang("en"));
    expect(result.current.report?.scope.productId).toBe("product-a");
    expect(vi.mocked(marketingApi.performance)).toHaveBeenCalledTimes(1);
  });

  it("reports failures as an error instead of an empty report", async () => {
    vi.mocked(marketingApi.performance).mockReset().mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useMarketingPerformance(queryA));
    await flush();
    expect(result.current.report).toBeNull();
    expect(result.current.error).toBe("offline");
    expect(result.current.loading).toBe(false);
  });

  it("refetches the current scope on reload", async () => {
    const { result } = renderHook(() => useMarketingPerformance(queryA));
    await flush();
    expect(vi.mocked(marketingApi.performance)).toHaveBeenCalledTimes(1);
    act(() => result.current.reload());
    await flush();
    expect(vi.mocked(marketingApi.performance)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(marketingApi.performance).mock.calls[1][0]).toEqual(queryA);
  });

  it("disables only the report when no scope is chosen and keeps options separate", async () => {
    vi.mocked(marketingApi.performanceOptions).mockRejectedValueOnce(new Error("options offline"));
    const { result } = renderHook(() => useMarketingPerformance(null));
    await flush();
    expect(vi.mocked(marketingApi.performance)).not.toHaveBeenCalled();
    expect(result.current.report).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.options).toBeNull();
    expect(result.current.optionsError).toBe("options offline");
  });
});
