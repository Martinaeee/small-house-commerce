import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { zh } from "@/i18n/zh";
import type { AdminI18n } from "@/lib/admin-i18n";
import type { AdminAvailabilityReport } from "@/lib/admin-api";
import { AvailabilityView } from "./AvailabilityView";

const t: AdminI18n["t"] = (key, vars) => {
  const template = (zh as Record<string, string>)[key] ?? String(key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
};

function day(day: string, state: "OK" | "DEGRADED" | "DOWN" | "NO_DATA", uptimePct: number | null) {
  return { day, state, uptimePct };
}

const report: AdminAvailabilityReport = {
  status: "OPERATIONAL",
  reason: "All 5 key routes passed the latest two probe rounds.",
  asOf: "2026-11-12T10:30:00.000Z",
  routes: [
    { key: "home", path: "/", dns: "PASS", tls: "PASS", http: "PASS", httpStatus: 200, latencyMs: 182, dom: "PASS", lastCheckedAt: "2026-11-12T10:29:42.000Z", source: "EXTERNAL", status: "OPERATIONAL" },
    { key: "collections", path: "/collections/all-products", dns: "PASS", tls: "PASS", http: "PASS", httpStatus: 200, latencyMs: 214, dom: "PASS", lastCheckedAt: "2026-11-12T10:29:42.000Z", source: "PROD", status: "OPERATIONAL" },
    { key: "product", path: "/products/example", dns: "PASS", tls: "PASS", http: "PASS", httpStatus: 200, latencyMs: 268, dom: "PASS", lastCheckedAt: "2026-11-12T10:29:42.000Z", source: "EXTERNAL", status: "OPERATIONAL" },
    { key: "cart", path: "/cart", dns: "PASS", tls: "PASS", http: "PASS", httpStatus: 200, latencyMs: 190, dom: "PASS", lastCheckedAt: "2026-11-12T10:29:42.000Z", source: "PROD", status: "OPERATIONAL" },
    { key: "checkout", path: "/checkout", dns: "PASS", tls: "PASS", http: "PASS", httpStatus: 200, latencyMs: 342, dom: "PASS", lastCheckedAt: "2026-11-12T10:29:42.000Z", source: "EXTERNAL", status: "OPERATIONAL" },
  ],
  uptime7d: [
    day("2026-11-06", "OK", 100),
    day("2026-11-07", "OK", 100),
    day("2026-11-08", "DEGRADED", 99.6),
    day("2026-11-09", "OK", 100),
    day("2026-11-10", "OK", 100),
    day("2026-11-11", "OK", 100),
    day("2026-11-12", "OK", 100),
  ],
  uptime30d: [day("2026-11-12", "OK", 100)],
  recentFailures: [
    { id: "f1", route: "/checkout", source: "EXTERNAL", at: "2026-11-12T02:14:00.000Z", httpStatus: 502, latencyMs: 3120, recoveredAt: "2026-11-12T02:16:00.000Z", note: "Upstream 502 for two consecutive rounds" },
  ],
  runs: [
    { runId: "run-000000000001", route: "home", source: "EXTERNAL", status: "OPERATIONAL", httpStatus: 200, latencyMs: 182, checkedAt: "2026-11-12T10:29:42.000Z" },
  ],
  nodes: [
    { key: "prod", label: "Production probe", state: "ONLINE", lastHeartbeatAt: "2026-11-12T10:29:50.000Z" },
    { key: "ext-sg", label: "External node (SG)", state: "ONLINE", lastHeartbeatAt: "2026-11-12T10:29:30.000Z" },
  ],
  edge: {
    available: true,
    generatedAt: "2026-11-12T10:29:00.000Z",
    stale: false,
    requests: 18422,
    errorRate5xx: 0,
    errorRate4xx: 1.2,
    slowestMs: 1840,
    slowestPath: "/api/v1/storefront/products",
    imageRealHitRate: 94.2,
    note: "Edge summary",
  },
};

describe("AvailabilityView (P1.5 preview)", () => {
  it("renders the probe matrix with real state names", () => {
    render(<AvailabilityView data={report} error={null} loading={false} onRefresh={() => {}} t={t} />);
    expect(screen.getByText("探测矩阵")).toBeTruthy();
    expect(screen.getAllByText("首页").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OPERATIONAL").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^SUCCESS$/)).toBeNull();
  });

  it("shows edge access diagnostics values and the cross-link", () => {
    render(<AvailabilityView data={report} error={null} loading={false} onRefresh={() => {}} t={t} />);
    expect(screen.getByText("边缘流量（访问诊断）")).toBeTruthy();
    expect(screen.getByText("1.2%")).toBeTruthy();
    expect(screen.getByText("94.2%")).toBeTruthy();
    const link = screen.getByText(/打开访问诊断/).closest("a");
    expect(link?.getAttribute("href")).toBe("/admin/status/access");
  });

  it("distinguishes an evaluated zero from unavailable edge data", () => {
    const empty = { ...report, recentFailures: [] };
    const { unmount } = render(
      <AvailabilityView data={empty} error={null} loading={false} onRefresh={() => {}} t={t} />,
    );
    expect(screen.getByText("过去 24 小时没有失败的探测轮次。")).toBeTruthy();
    unmount();

    render(
      <AvailabilityView
        data={{ ...report, edge: null }}
        error={null}
        loading={false}
        onRefresh={() => {}}
        t={t}
      />,
    );
    expect(screen.getByText("访问诊断当前不可用。")).toBeTruthy();
  });

  it("renders probe node heartbeats inside the diagnostics area", () => {
    render(<AvailabilityView data={report} error={null} loading={false} onRefresh={() => {}} t={t} />);
    expect(screen.getByText("探针节点心跳")).toBeTruthy();
    expect(screen.getByText("Production probe")).toBeTruthy();
    expect(screen.getAllByText("在线").length).toBe(2);
  });

  it("keeps the routes of one probe round separately expandable", () => {
    // One round covers every route and shares a single run id, so the round id
    // alone cannot identify a row.
    const twoRoutesOneRound: AdminAvailabilityReport = {
      ...report,
      runs: [
        { runId: "run-shared", route: "home", source: "PROD", status: "OPERATIONAL", httpStatus: 200, latencyMs: 180, checkedAt: "2026-11-12T10:29:42.000Z" },
        { runId: "run-shared", route: "cart", source: "PROD", status: "DEGRADED", httpStatus: 200, latencyMs: 900, checkedAt: "2026-11-12T10:29:47.000Z" },
      ],
    };
    render(
      <AvailabilityView data={twoRoutesOneRound} error={null} loading={false} onRefresh={() => {}} t={t} />,
    );

    // The mobile list is the one with the disclosure buttons.
    const homeRow = screen
      .getAllByText("home")
      .find((node) => node.closest("button"))!;
    expect(homeRow).toBeTruthy();
    fireEvent.click(homeRow);
    // Only the tapped route opens: the detail line is the only place the full
    // run id appears outside the desktop table, so exactly one such line exists.
    const detailLines = screen
      .getAllByText(/run-shared/)
      .filter((node) => node.tagName === "P");
    expect(detailLines.length).toBe(1);
  });
});
