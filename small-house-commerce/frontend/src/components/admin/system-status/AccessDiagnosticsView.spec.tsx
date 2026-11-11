import { render, screen } from "@testing-library/react";
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
  slowest: [{ ms: 1200, uri: "/_next/image?url=x&w=1440&q=75", status: 200 }],
  statusCounts: { "200": 988, "404": 12 },
};

const degraded: AdminAccessReport = {
  ...healthy,
  status5xx: 8,
  errorRate5xx: 0.8,
  images: { requests: 400, hit: 80, miss: 320, hitRate: 20 },
  top5xxPaths: [["/api/v1/storefront/cart", 8]],
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

  it("shows the request totals and the image hit rate", () => {
    renderView({ data: healthy });

    expect(screen.getByText("1,000")).toBeTruthy();
    // The hit rate appears in the summary strip and again in the cache table.
    expect(screen.getAllByText("95%").length).toBeGreaterThan(0);
    expect(screen.getByText(zh.access_diagnostics_no_5xx)).toBeTruthy();
  });

  it("lists 5xx paths when there are server errors", () => {
    renderView({ data: degraded });

    expect(screen.getByText("/api/v1/storefront/cart")).toBeTruthy();
    // The count shows in the summary strip and in the path row.
    expect(screen.getAllByText("8").length).toBeGreaterThan(0);
    expect(screen.queryByText(zh.access_diagnostics_no_5xx)).toBeNull();
  });

  it("warns when the report is stale", () => {
    renderView({ data: { ...healthy, stale: true } });

    expect(screen.getByText(zh.access_diagnostics_stale)).toBeTruthy();
  });

  it("shows the slowest request rows", () => {
    renderView({ data: healthy });

    expect(screen.getByText("1200ms")).toBeTruthy();
    expect(screen.getByText("/_next/image?url=x&w=1440&q=75")).toBeTruthy();
  });
});
