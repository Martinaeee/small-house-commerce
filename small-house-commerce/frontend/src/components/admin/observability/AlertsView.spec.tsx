import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { zh } from "@/i18n/zh";
import type { AdminI18n } from "@/lib/admin-i18n";
import type { AdminAlertList } from "@/lib/admin-api";
import { AlertsView } from "./AlertsView";

const t: AdminI18n["t"] = (key, vars) => {
  const template = (zh as Record<string, string>)[key] ?? String(key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
};

const data: AdminAlertList = {
  alertingEnabled: true,
  issues: [
    {
      id: "a1",
      ruleCode: "PDP_5XX_TIMEOUT",
      fingerprint: "PDP_5XX_TIMEOUT",
      severity: "P1",
      status: "OPEN",
      title: "PDP server errors or slow responses",
      detail: "2 PDP 5xx rows; 1 slow request",
      firstSeenAt: "2026-11-14T09:50:00.000Z",
      lastSeenAt: "2026-11-14T10:05:00.000Z",
      occurrences: 3,
      acknowledgedAt: null,
      closedAt: null,
      snoozedUntil: null,
    },
    {
      id: "a2",
      ruleCode: "PROBE_DOWN",
      fingerprint: "PROBE_DOWN:checkout",
      severity: "P0",
      status: "CLOSED",
      title: "checkout route is down",
      detail: "HTTP 502",
      firstSeenAt: "2026-11-14T02:13:00.000Z",
      lastSeenAt: "2026-11-14T02:16:00.000Z",
      occurrences: 1,
      acknowledgedAt: null,
      closedAt: "2026-11-14T02:16:00.000Z",
      snoozedUntil: null,
    },
  ],
};

function renderView(
  overrides: Partial<ComponentProps<typeof AlertsView>> = {},
) {
  const onUpdate = vi.fn();
  const onRefresh = vi.fn();
  render(
    <AlertsView
      data={data}
      error={null}
      loading={false}
      canUpdate
      updatingId={null}
      onUpdate={onUpdate}
      onRefresh={onRefresh}
      t={t}
      {...overrides}
    />,
  );
  return { onUpdate, onRefresh };
}

describe("AlertsView (P2-lite)", () => {
  it("shows open issues with severity, counts and state actions", () => {
    const { onUpdate } = renderView();
    expect(screen.getByText("PDP server errors or slow responses")).toBeTruthy();
    expect(screen.getAllByText("P1").length).toBeGreaterThan(0);
    expect(screen.getByText("3")).toBeTruthy();
    fireEvent.click(screen.getByText("确认"));
    expect(onUpdate).toHaveBeenCalledWith("a1", "ACKNOWLEDGED");
  });

  it("separates open and closed filters", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "已关闭" }));
    expect(screen.getByText("checkout route is down")).toBeTruthy();
    expect(screen.queryByText("PDP server errors or slow responses")).toBeNull();
  });

  it("treats an empty evaluated list as no active issues, not no data", () => {
    renderView({ data: { alertingEnabled: true, issues: [] } });
    expect(screen.getAllByText("未检测到活跃问题。").length).toBeGreaterThan(0);
  });

  it("never claims an empty result when alerting is disabled", () => {
    renderView({ data: { alertingEnabled: false, issues: [] } });
    expect(screen.getAllByText("告警尚未启用（P2-lite）。").length).toBeGreaterThan(0);
    expect(screen.queryByText("未检测到活跃问题。")).toBeNull();
  });

  it("hides state actions without SYSTEM_SETTINGS_EDIT", () => {
    renderView({ canUpdate: false });
    expect(screen.queryByText("确认")).toBeNull();
    expect(screen.queryByText("关闭")).toBeNull();
  });
});
