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
  windowFirstAt: "2026-11-11T08:00:00.000Z",
  windowLastAt: "2026-11-11T09:00:00.000Z",
  requests: 1000,
  traffic: { human: 900, bot: 100, warmup: 0 },
  status5xx: 0,
  status4xx: 12,
  errorRate5xx: 0,
  images: {
    requests: 400,
    hit: 380,
    miss: 20,
    hitRate: 95,
    realHitRate: 95,
    warmupRequests: 0,
  },
  top5xxPaths: [],
  errors: [
    {
      code: 404,
      path: "/meta.json",
      count: 12,
      firstAt: "2026-11-11T08:10:00.000Z",
      lastAt: "2026-11-11T08:55:00.000Z",
      bot: true,
      sampleUa: "facebookexternalhit/1.1",
      sampleReferer: "",
    },
  ],
  slowest: [
    {
      ms: 1200,
      uri: "/_next/image?url=%2Fuploads%2Fcatalog%2F2026%2Fhero.png&w=1440&q=75",
      status: 200,
      cache: "HIT",
      referer: "https://luwag.shop/products/standing-desk",
      traffic: "human",
      image: {
        file: "hero.png",
        width: 1440,
        productName: "Standing Desk",
        productSlug: "standing-desk",
        kind: "main",
      },
    },
  ],
  statusCounts: { "200": 988, "404": 12 },
};

const degraded: AdminAccessReport = {
  ...healthy,
  status5xx: 8,
  errorRate5xx: 0.8,
  images: {
    requests: 400,
    hit: 80,
    miss: 320,
    hitRate: 20,
    realHitRate: 20,
    warmupRequests: 0,
  },
  errors: [
    {
      code: 500,
      path: "/api/v1/storefront/cart",
      count: 8,
      firstAt: "2026-11-11T08:10:00.000Z",
      lastAt: "2026-11-11T08:55:00.000Z",
      bot: false,
      sampleUa: "Mozilla/5.0 (iPhone)",
      sampleReferer: "https://luwag.shop/products/desk",
    },
  ],
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
    expect(screen.getByText(/本窗口有 8 个服务端错误/)).toBeTruthy();
  });

  it("shows the four KPI cards", () => {
    renderView({ data: healthy });
    expect(screen.getByText(zh.access_diagnostics_requests)).toBeTruthy();
    expect(screen.getByText(zh.access_diagnostics_5xx)).toBeTruthy();
    expect(screen.getByText(zh.access_diagnostics_4xx)).toBeTruthy();
    expect(screen.getByText(zh.access_diagnostics_image_hit)).toBeTruthy();
  });

  it("shows the window range alongside the request count", () => {
    renderView({ data: healthy });
    expect(screen.getByText(/统计范围/)).toBeTruthy();
  });

  it("marks the warm-up fields as not wired instead of inventing numbers", () => {
    renderView({ data: healthy });
    const coverage = screen.getByText(zh.access_diagnostics_image_coverage);
    const row = coverage.parentElement as HTMLElement;
    expect(within(row).getByText(zh.access_diagnostics_not_wired)).toBeTruthy();
  });

  it("labels a 404 as a crawler hit rather than a visitor failure", () => {
    renderView({ data: healthy });
    const codeCell = screen.getAllByText("404")[0];
    const row = codeCell.closest("tr") as HTMLElement;
    expect(within(row).getByText(zh.access_diagnostics_error_bot)).toBeTruthy();
  });

  it("labels a 500 as a server failure", () => {
    renderView({ data: degraded });
    const codeCell = screen.getAllByText("500")[0];
    const row = codeCell.closest("tr") as HTMLElement;
    expect(within(row).getByText(zh.access_diagnostics_verdict_server)).toBeTruthy();
  });

  it("shows the product name instead of the raw file name", () => {
    renderView({ data: healthy });
    expect(screen.getAllByText("Standing Desk").length).toBeGreaterThan(0);
  });

  it("reveals the full URL, width and source page when a slow row is clicked", () => {
    renderView({ data: healthy });

    fireEvent.click(screen.getAllByText("Standing Desk")[0]);

    expect(
      screen.getAllByText("/_next/image?url=%2Fuploads%2Fcatalog%2F2026%2Fhero.png&w=1440&q=75")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("1440px").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/products/standing-desk").length).toBeGreaterThan(0);
  });

  it("reveals crawler evidence when an error row is clicked", () => {
    renderView({ data: healthy });

    fireEvent.click(screen.getAllByText("/meta.json")[0]);

    expect(screen.getAllByText("facebookexternalhit/1.1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(zh.access_diagnostics_error_first).length).toBeGreaterThan(0);
    expect(screen.getAllByText(zh.access_diagnostics_error_last).length).toBeGreaterThan(0);
  });

  it("filters the slowest list by request kind", () => {
    renderView({
      data: {
        ...healthy,
        slowest: [
          healthy.slowest[0],
          {
            ms: 900,
            uri: "/api/v1/storefront/cart",
            status: 200,
            cache: "MISS",
            referer: "",
            traffic: "human",
            image: null,
          },
        ],
      },
    });

    expect(screen.getAllByText("/storefront/cart").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: zh.access_diagnostics_kind_api }));

    expect(screen.queryByText("Standing Desk")).toBeNull();
    expect(screen.getAllByText("/storefront/cart").length).toBeGreaterThan(0);
  });

  it("warns when the report is stale", () => {
    renderView({ data: { ...healthy, stale: true } });
    expect(screen.getByText(zh.access_diagnostics_stale)).toBeTruthy();
  });

  it("says the cache is warming when warm-up traffic is in the window", () => {
    renderView({
      data: {
        ...healthy,
        images: {
          requests: 400,
          hit: 160,
          miss: 240,
          hitRate: 40,
          realHitRate: 40,
          warmupRequests: 120,
        },
      },
    });

    expect(screen.getByText(zh.access_diagnostics_status_attention)).toBeTruthy();
    expect(screen.getAllByText(/预热正在执行/).length).toBeGreaterThan(0);
  });

  it("says the warm-up may have failed when the rate is low and nothing is warming", () => {
    renderView({
      data: {
        ...healthy,
        images: {
          requests: 400,
          hit: 80,
          miss: 320,
          hitRate: 20,
          realHitRate: 20,
          warmupRequests: 0,
        },
      },
    });

    expect(screen.getAllByText(/预热可能失败/).length).toBeGreaterThan(0);
  });
});
