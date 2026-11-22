import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { zh } from "@/i18n/zh";
import type { AdminI18n } from "@/lib/admin-i18n";
import type { AdminAlertList, AdminAvailabilityReport, AdminStorefrontHealth } from "@/lib/admin-api";
import { HealthHomeView } from "./HealthHomeView";

const t: AdminI18n["t"] = (key, vars) => {
  const template = (zh as Record<string, string>)[key] ?? String(key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
};

const health: AdminStorefrontHealth = {
  status: "UNKNOWN",
  reason: "No probe or alert evidence is configured yet; storefront health cannot be asserted.",
  asOf: "2026-11-10T07:00:00.000Z",
  sections: {
    availability: { state: "NO_DATA", note: "Synthetic probes are not enabled yet (P1.5)." },
    issues: { state: "NO_DATA", note: "Alerting is not enabled yet (P2-lite)." },
    pageExperience: { state: "NOT_ENABLED", note: "RUM is not enabled yet (P4)." },
    checkout: { state: "NO_DATA", note: "API diagnostics are not enabled yet (P3)." },
  },
  telemetryActivity: {
    state: "VALUE",
    lastEventAt: "2026-11-10T06:59:00.000Z",
    events24h: 418,
    sources: ["analytics_events"],
    note: "Informational only: no independent collector heartbeat is available, so this does not assert pipeline HEALTHY/FAILED.",
  },
};

describe("HealthHomeView (P1R final)", () => {
  it("shows the real UNKNOWN status, never a green default", () => {
    const { container } = render(<HealthHomeView data={health} t={t} />);
    const badge = container.querySelector("[data-health-status]");
    expect(badge?.getAttribute("data-health-status")).toBe("UNKNOWN");
    expect(badge?.textContent).toBe("UNKNOWN");
    expect(screen.getByText(/cannot be asserted/i)).toBeVisible();
    expect(container.textContent).not.toContain("OPERATIONAL");
    expect(container.textContent).not.toContain("SUCCESS");
  });

  it("distinguishes NO DATA / NOT ENABLED and never claims an issue check", () => {
    const { container } = render(<HealthHomeView data={health} t={t} />);
    expect(screen.getAllByText("暂无监控数据。").length).toBeGreaterThan(0);
    expect(screen.getAllByText("尚未启用").length).toBeGreaterThan(0);
    expect(screen.getByText("暂无可用的优先级数据。")).toBeVisible();
    // Must not imply monitoring ran and found nothing.
    const text = container.textContent ?? "";
    expect(text).not.toContain("暂无需优先处理的问题");
    expect(text).not.toContain("未检测到活跃问题");
  });

  it("renders the four health sections and no business KPIs", () => {
    const { container } = render(<HealthHomeView data={health} t={t} />);
    for (const title of ["网站可用性", "活跃问题", "页面体验", "结账健康"]) {
      expect(screen.getByText(title)).toBeVisible();
    }
    const text = container.textContent ?? "";
    for (const forbidden of ["会话数", "订单数", "已确认订单", "有记录的归因", "广告级订单", "CAPI 投递"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("renders each of the five real statuses with its own name", () => {
    for (const status of ["OPERATIONAL", "DEGRADED", "DOWN", "UNKNOWN", "MAINTENANCE"] as const) {
      const { container, unmount } = render(
        <HealthHomeView data={{ ...health, status }} t={t} />,
      );
      const badge = container.querySelector("[data-health-status]");
      expect(badge?.getAttribute("data-health-status")).toBe(status);
      expect(badge?.textContent).toBe(status);
      unmount();
    }
  });

  it("shows an evaluated section with its real state name, never SUCCESS", () => {
    const valued = {
      ...health,
      sections: {
        ...health.sections,
        availability: { state: "VALUE" as const, status: "OPERATIONAL" as const, note: "5 of 5 routes passed." },
      },
    };
    const { container } = render(<HealthHomeView data={valued} t={t} />);
    expect(screen.getByText("OPERATIONAL")).toBeVisible();
    expect(container.textContent).not.toContain("SUCCESS");
  });

  it("folds availability details into the card on demand", () => {
    const valued = {
      ...health,
      sections: {
        ...health.sections,
        availability: { state: "VALUE" as const, status: "OPERATIONAL" as const, note: "5 of 5 routes passed." },
      },
    };
    const availability = {
      status: "OPERATIONAL" as const,
      reason: "All routes passed.",
      asOf: "2026-11-12T10:30:00.000Z",
      routes: [
        {
          key: "home",
          path: "/",
          dns: "PASS" as const,
          tls: "PASS" as const,
          http: "PASS" as const,
          httpStatus: 200,
          latencyMs: 182,
          dom: "PASS" as const,
          lastCheckedAt: "2026-11-12T10:29:42.000Z",
          source: "EXTERNAL" as const,
          status: "OPERATIONAL" as const,
        },
      ],
      uptime7d: [{ day: "2026-11-12", state: "OK" as const, uptimePct: 100 }],
      uptime30d: [],
      recentFailures: [],
      runs: [],
      nodes: [],
      edge: null,
    } satisfies AdminAvailabilityReport;
    const { container } = render(
      <HealthHomeView data={valued} availability={availability} t={t} />,
    );
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(screen.getByText("探测详情")).toBeTruthy();

    fireEvent.click(details!.querySelector("summary")!);
    expect(details?.open).toBe(true);
    expect(screen.getAllByText("首页").length).toBeGreaterThan(0);
    expect(screen.getAllByText("182 ms").length).toBeGreaterThan(0);
  });

  it("renders evaluated active issues instead of the no-data placeholder", () => {
    const valued = {
      ...health,
      sections: {
        ...health.sections,
        issues: { state: "VALUE" as const, status: "DEGRADED" as const, note: "1 active issue(s)." },
      },
    };
    const alerts: AdminAlertList = {
      alertingEnabled: true,
      issues: [
        {
          id: "a1",
          ruleCode: "PDP_5XX_TIMEOUT",
          fingerprint: "PDP_5XX_TIMEOUT",
          severity: "P1",
          status: "OPEN",
          title: "PDP server errors or slow responses",
          detail: "2 PDP 5xx rows",
          firstSeenAt: "2026-11-14T09:50:00.000Z",
          lastSeenAt: "2026-11-14T10:05:00.000Z",
          occurrences: 3,
          acknowledgedAt: null,
          closedAt: null,
          snoozedUntil: null,
        },
      ],
    };
    const { container } = render(<HealthHomeView data={valued} alerts={alerts} t={t} />);
    expect(screen.getAllByText("PDP server errors or slow responses").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("暂无可用的优先级数据。");
  });

  it("does not claim a clean result while alerting is disabled", () => {
    const { container } = render(
      <HealthHomeView
        data={health}
        alerts={{ alertingEnabled: false, issues: [] }}
        t={t}
      />,
    );
    // An empty list from a disabled engine is not evidence of a healthy system.
    expect(container.textContent).not.toContain("未检测到活跃问题。");
    expect(screen.getAllByText("告警尚未启用（P2-lite）。").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-health-status='OPERATIONAL']")).toBeNull();
  });

  it("still reports a clean result when alerting is enabled and no issue is open", () => {
    const { container } = render(
      <HealthHomeView
        data={health}
        alerts={{ alertingEnabled: true, issues: [] }}
        t={t}
      />,
    );
    expect(container.textContent).toContain("未检测到活跃问题。");
  });
});
