import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { zh } from "@/i18n/zh";
import type { AdminI18n } from "@/lib/admin-i18n";
import type { AdminApiDiagnostics, AdminRequestTrace } from "@/lib/admin-api";
import { ApiCheckoutView } from "./ApiCheckoutView";

const t: AdminI18n["t"] = (key, vars) => {
  const template = (zh as Record<string, string>)[key] ?? String(key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
};

const diagnostics: AdminApiDiagnostics = {
  collector: null,
  state: "VALUE",
  note: "API handler samples only.",
  collecting: true,
  sampleRate: 1,
  asOf: "2026-11-20T10:05:00.000Z",
  windowMinutes: 1440,
  lastSampleAt: "2026-11-20T10:04:30.000Z",
  routes: [
    {
      routeGroup: "orders",
      requests: 120,
      p50Ms: 320.4,
      p90Ms: 780.2,
      p95Ms: 1200.7,
      serverErrors: 2,
      clientErrors: 5,
      slowRequests: 3,
      budgetMs: 2000,
      lastAt: "2026-11-20T10:04:00.000Z",
    },
    {
      routeGroup: "product",
      requests: 300,
      p50Ms: 180,
      p90Ms: 950,
      p95Ms: 2400,
      serverErrors: 0,
      clientErrors: 1,
      slowRequests: 12,
      budgetMs: 2000,
      lastAt: "2026-11-20T10:04:20.000Z",
    },
  ],
  checkout: {
    steps: [
      { key: "begin_checkout", events: 60, sessions: 55 },
      { key: "submit_attempt", events: 40, sessions: 36 },
      { key: "submit_failed", events: 6, sessions: 6 },
      { key: "purchase", events: 30, sessions: 30 },
    ],
    failureReasons: [
      { reason: "STOCK", count: 4 },
      { reason: "SERVER", count: 2 },
    ],
  },
  recentFailures: [
    {
      requestId: "req-abc",
      routeGroup: "orders",
      method: "POST",
      path: "/api/v1/storefront/orders",
      status: 500,
      durationMs: 2400,
      at: "2026-11-20T10:03:00.000Z",
    },
  ],
};

const trace: AdminRequestTrace = {
  requestId: "req-abc",
  correlation: "CORRELATED",
  server: {
    method: "POST",
    path: "/api/v1/storefront/orders",
    routeGroup: "orders",
    status: 500,
    durationMs: 2400,
    at: "2026-11-20T10:03:00.000Z",
  },
  browser: {
    events: [
      {
        eventName: "CHECKOUT_SUBMIT_FAILED",
        at: "2026-11-20T10:03:01.000Z",
        reason: "SERVER",
        httpStatus: 500,
      },
    ],
    failureReason: "SERVER",
  },
  note: "Browser attempt and server sample share this request id.",
};

function renderView(overrides: Partial<React.ComponentProps<typeof ApiCheckoutView>> = {}) {
  return render(
    <ApiCheckoutView
      data={diagnostics}
      trace={null}
      traceError={null}
      traceLoading={false}
      onLookup={vi.fn()}
      onRefresh={vi.fn()}
      refreshing={false}
      t={t}
      {...overrides}
    />,
  );
}

describe("ApiCheckoutView (P3)", () => {
  it("never claims a clean result after a failed diagnostics query", () => {
    const { container } = renderView({ data: { ...diagnostics, state: "UNKNOWN", note: "Database unavailable", routes: [], checkout: { steps: [], failureReasons: [] }, recentFailures: [] } });
    expect(container.textContent).toContain("UNKNOWN");
    expect(container.textContent).toContain("Database unavailable");
    expect(container.textContent).not.toContain("没有提交失败记录");
    expect(container.textContent).not.toContain("没有 5xx");
  });

  it("does not infer healthy steps from the mere presence of analytics events", () => {
    const { container } = renderView();
    expect(container.querySelector('ol [data-status="SUCCESS"]')).toBeNull();
  });
  it("shows route percentiles and marks p95 over budget", () => {
    const { container } = renderView();
    expect(screen.getAllByText("商品接口（PDP）").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("2400 ms");
    expect(screen.getByText("接口健康")).toBeVisible();
    expect(screen.getByText(/PDP p95 告警基于商品接口/)).toBeVisible();
  });

  it("renders the checkout chain with event and session counts", () => {
    renderView();
    for (const title of ["发起结账", "点击提交", "提交失败", "购买事件"]) {
      expect(screen.getAllByText(new RegExp(title)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/40 次/).length).toBeGreaterThan(0);
  });

  it("lists failure reasons and recent failing requests", () => {
    renderView();
    expect(screen.getByText("STOCK")).toBeVisible();
    expect(screen.getByText("SERVER")).toBeVisible();
    expect(screen.getByText("req-abc")).toBeVisible();
  });

  it("looks up a request id from the recent failures", () => {
    const onLookup = vi.fn();
    renderView({ onLookup });
    fireEvent.click(screen.getByRole("button", { name: "req-abc" }));
    expect(onLookup).toHaveBeenCalledWith("req-abc");
  });

  it("submits the manual request id form", () => {
    const onLookup = vi.fn();
    renderView({ onLookup });
    fireEvent.change(screen.getByLabelText("request id"), {
      target: { value: "abcd-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onLookup).toHaveBeenCalledWith("abcd-1234");
  });

  it("shows the correlation result and its two evidence sides", () => {
    renderView({ trace });
    expect(screen.getAllByText(/CORRELATED/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("服务端样本").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CHECKOUT_SUBMIT_FAILED/).length).toBeGreaterThan(0);
  });

  it("distinguishes disabled collection from an empty collecting window", () => {
    const { rerender } = renderView({
      data: { ...diagnostics, collecting: false, routes: [], recentFailures: [] },
    });
    expect(screen.getByText(/API_METRICS_ENABLED=false/)).toBeVisible();
    expect(screen.getByText("接口指标采集尚未启用。")).toBeVisible();

    rerender(
      <ApiCheckoutView
        data={{ ...diagnostics, collecting: true, routes: [], recentFailures: [] }}
        trace={null}
        traceError={null}
        traceLoading={false}
        onLookup={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        t={t}
      />,
    );
    expect(screen.getByText("尚未采到接口样本。")).toBeVisible();
  });

  it("shows an invalid request id error", () => {
    renderView({ traceError: "invalid" });
    expect(screen.getByText("Request ID 格式无效。")).toBeVisible();
  });
});
