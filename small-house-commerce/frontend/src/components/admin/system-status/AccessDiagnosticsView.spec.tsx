import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { zh } from "@/i18n/zh";
import type { AdminI18n } from "@/lib/admin-i18n";
import type { AdminAccessReport } from "@/lib/admin-api";
import { AccessDiagnosticsView } from "./AccessDiagnosticsView";

const t: AdminI18n["t"] = (key, vars) => {
  const template = (zh as Record<string, string>)[key] ?? String(key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
};

const healthy: AdminAccessReport = {
  generatedAt: "2026-11-11T09:00:00.000Z",
  stale: false,
  windowLines: 20000,
  requests: 1000,
  status5xx: 0,
  status4xx: 12,
  errorRate5xx: 0,
  images: { requests: 400, hit: 380, miss: 20, hitRate: 95 },
  top5xxPaths: [],
  slowest: [
    {
      ms: 1200,
      uri: "/_next/image?url=%2Fuploads%2Fcatalog%2F2026%2Fhero.png&w=1440&q=75",
      status: 200,
    },
  ],
  statusCounts: { "200": 988, "404": 12 },
};

const degraded: AdminAccessReport = {
  ...healthy,
  status5xx: 8,
  errorRate5xx: 0.8,
  images: { requests: 400, hit: 80, miss: 320, hitRate: 20 },
  top5xxPaths: [["/api/v1/storefront/cart", 8]],
  statusCounts: { "200": 980, "404": 12, "500": 8 },
};

function renderView(overrides: Partial<Parameters<typeof AccessDiagnosticsView>[0]>) {
  return render(
    <AccessDiagnosticsView
      data={null}
      error={null}
      loading={false}
      onRefresh={() => {}}
      t={t}
      {...overrides}
    />,
  );
}

describe("AccessDiagnosticsView", () => {
  it("says the report is unavailable when the collector has not run", () => {
    renderView({ error: "unavailable" });

    expect(screen.getByText(zh.access_diagnostics_unavailable)).toBeTruthy();
  });

  it("opens with a healthy banner when there are no 5xx and the cache is warm", () => {
    renderView({ data: healthy });

    expect(screen.getByText(zh.access_diagnostics_status_ok)).toBeTruthy();
  });

  it("opens with a critical banner as soon as a 5xx appears", () => {
    renderView({ data: degraded });

    expect(screen.getByText(zh.access_diagnostics_status_critical)).toBeTruthy();
    expect(
      screen.getByText(/本窗口有 8 个服务端错误/),
    ).toBeTruthy();
  });

  it("shows the four KPI cards", () => {
    renderView({ data: healthy });

    expect(screen.getByText(zh.access_diagnostics_requests)).toBeTruthy();
    expect(screen.getByText(zh.access_diagnostics_5xx)).toBeTruthy();
    expect(screen.getByText(zh.access_diagnostics_4xx)).toBeTruthy();
    expect(screen.getByText(zh.access_diagnostics_image_hit)).toBeTruthy();
  });

  it("shows the image hit rate in the donut and the breakdown", () => {
    renderView({ data: healthy });

    expect(screen.getAllByText("95%").length).toBeGreaterThan(0);
    // "Hit"/"Miss" label the donut and again the breakdown list.
    expect(screen.getAllByText(zh.access_diagnostics_image_chart_hit).length).toBeGreaterThan(0);
    expect(screen.getAllByText(zh.access_diagnostics_image_chart_miss).length).toBeGreaterThan(0);
  });

  it("marks the warm-up fields as not wired instead of inventing numbers", () => {
    renderView({ data: healthy });

    const coverage = screen.getByText(zh.access_diagnostics_image_coverage);
    const row = coverage.parentElement as HTMLElement;
    expect(within(row).getByText(zh.access_diagnostics_not_wired)).toBeTruthy();
  });

  it("classifies a 404 as a client error, not a server failure", () => {
    renderView({ data: healthy });

    const codeCell = screen.getByText("404");
    const row = codeCell.closest("tr") as HTMLElement;
    expect(within(row).getByText(zh.access_diagnostics_verdict_client)).toBeTruthy();
  });

  it("marks a 500 as a server failure", () => {
    renderView({ data: degraded });

    const codeCell = screen.getByText("500");
    const row = codeCell.closest("tr") as HTMLElement;
    expect(within(row).getByText(zh.access_diagnostics_verdict_server)).toBeTruthy();
  });

  it("shows the resource name, not the full URL, in the slowest table", () => {
    renderView({ data: healthy });

    // The desktop table and the mobile card list both render the name.
    expect(screen.getAllByText("hero.png").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("/_next/image?url=%2Fuploads%2Fcatalog%2F2026%2Fhero.png&w=1440&q=75"),
    ).toBeNull();
  });

  it("reveals the full URL when a slow request row is clicked", () => {
    renderView({ data: healthy });

    fireEvent.click(screen.getAllByText("hero.png")[0]);

    // Both the desktop table and the mobile card render the detail panel.
    expect(
      screen.getAllByText("/_next/image?url=%2Fuploads%2Fcatalog%2F2026%2Fhero.png&w=1440&q=75")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(zh.access_diagnostics_detail_url).length).toBeGreaterThan(0);
  });

  it("filters the slowest table by request kind", () => {
    renderView({
      data: {
        ...healthy,
        slowest: [
          { ms: 1200, uri: "/_next/image?url=%2Fx.png&w=640&q=75", status: 200 },
          { ms: 900, uri: "/api/v1/storefront/cart", status: 200 },
        ],
      },
    });

    expect(screen.getAllByText("x.png").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/storefront/cart").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: zh.access_diagnostics_kind_api }));

    expect(screen.queryByText("x.png")).toBeNull();
    expect(screen.getAllByText("/storefront/cart").length).toBeGreaterThan(0);
  });

  it("warns when the report is stale", () => {
    renderView({ data: { ...healthy, stale: true } });

    expect(screen.getByText(zh.access_diagnostics_stale)).toBeTruthy();
  });
});
