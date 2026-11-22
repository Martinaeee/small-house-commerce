import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HealthStatusBadge, StatusBadge } from "./StatusBadge";
import { StepHealthChain } from "./StepHealthChain";
import { SystemDiagnostics } from "./SystemDiagnostics";
import { TrendChart } from "./TrendChart";

describe("StatusBadge", () => {
  it("renders the six-state vocabulary verbatim", () => {
    for (const status of ["SUCCESS", "WARNING", "FAILED", "UNKNOWN", "NOT_SUPPORTED", "NO_DATA"] as const) {
      const { container } = render(<StatusBadge status={status} />);
      const label = status === "NOT_SUPPORTED" ? "NOT SUPPORTED" : status === "NO_DATA" ? "NO DATA" : status;
      expect(container.textContent).toBe(label);
    }
  });
});

describe("StepHealthChain", () => {
  it("renders the technical step chain with per-step badges", () => {
    const { getByText, getAllByText } = render(
      <StepHealthChain
        steps={[
          { key: "landing", label: "Landing", state: "SUCCESS" },
          { key: "product", label: "Product", state: "SUCCESS" },
          { key: "cart", label: "Cart", state: "WARNING", detail: "2 failed requests" },
          { key: "checkout", label: "Checkout", state: "NO_DATA" },
        ]}
      />,
    );
    expect(getByText("1. Landing")).toBeTruthy();
    expect(getByText("2 failed requests")).toBeTruthy();
    expect(getAllByText("WARNING").length).toBe(1);
    expect(getAllByText("NO DATA").length).toBe(1);
  });
});

describe("TrendChart", () => {
  const labels = { ok: "OK", incomplete: "INCOMPLETE", noData: "NO DATA", unknown: "UNKNOWN" };
  const base = { unknownLabel: "unknown", noDataLabel: "empty", gapLabel: "gap", statusLabels: labels };

  it("does not connect across NO_DATA gaps", () => {
    const { container } = render(
      <TrendChart
        {...base}
        seriesState="VALUE"
        points={[
          { day: "2026-11-04", value: 5, state: "OK" },
          { day: "2026-11-05", value: null, state: "NO_DATA" },
          { day: "2026-11-06", value: 3, state: "OK" },
        ]}
      />,
    );
    expect(container.querySelectorAll("polyline").length).toBe(0);
    expect(container.querySelectorAll("circle").length).toBe(2);
  });
});

describe("HealthStatusBadge", () => {
  it("renders the five real state names, never severity aliases", () => {
    for (const status of ["OPERATIONAL", "DEGRADED", "DOWN", "UNKNOWN", "MAINTENANCE"] as const) {
      const { container } = render(<HealthStatusBadge status={status} />);
      const el = container.querySelector("[data-health-status]") as HTMLElement;
      expect(el.getAttribute("data-health-status")).toBe(status);
      expect(el.textContent).toBe(status);
      expect(el.className).not.toMatch(/SUCCESS|WARNING|FAILED/);
    }
  });

  it("never renders UNKNOWN with a green tone", () => {
    const { container } = render(<HealthStatusBadge status="UNKNOWN" />);
    const el = container.querySelector("[data-health-status]") as HTMLElement;
    expect(el.className).not.toContain("emerald");
    expect(el.className).toContain("slate");
  });

  it("falls back to UNKNOWN for invalid or missing status", () => {
    for (const bad of ["NOT_A_STATUS", "", null, undefined]) {
      const { container } = render(<HealthStatusBadge status={bad as never} />);
      const el = container.querySelector("[data-health-status]") as HTMLElement;
      expect(el.getAttribute("data-health-status")).toBe("UNKNOWN");
      expect(el.textContent).toBe("UNKNOWN");
    }
  });
});

describe("SystemDiagnostics", () => {
  const t = ((key: string) => key) as never;
  const telemetry = {
    state: "VALUE" as const,
    lastEventAt: "2026-11-10T06:59:00.000Z",
    events24h: 418,
    sources: ["analytics_events"],
    note: "informational only",
  };

  it("is collapsed by default and keeps the disclaimer visible when opened", () => {
    const { container, getByText } = render(<SystemDiagnostics telemetry={telemetry} t={t} />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(getByText("health_telemetry_disclaimer")).toBeTruthy();
  });

  it("shows facts for VALUE telemetry", () => {
    const { getByText } = render(<SystemDiagnostics telemetry={telemetry} t={t} />);
    expect(getByText("418")).toBeTruthy();
    expect(getByText("analytics_events")).toBeTruthy();
  });

  it("shows UNKNOWN when telemetry is missing or unknown", () => {
    for (const value of [undefined, { ...telemetry, state: "UNKNOWN" as const, note: "withheld" }]) {
      const { getByText, unmount } = render(<SystemDiagnostics telemetry={value} t={t} />);
      expect(getByText("UNKNOWN")).toBeTruthy();
      unmount();
    }
  });
});

describe("P1R guard: no business analytics inside Storefront Health", () => {
  it("source files contain no business KPI or attribution markers", () => {
    const files = [
      "HealthHomeView.tsx",
      "PhasePlaceholder.tsx",
      "StepHealthChain.tsx",
      "SystemDiagnostics.tsx",
    ];
    for (const file of files) {
      const path = fileURLToPath(new URL(file, import.meta.url));
      const source = readFileSync(path, "utf8");
      for (const forbidden of [
        "observability_kpi_",
        "kpi-sessions",
        "kpi-recorded-attribution",
        "attribution_kpi",
        "adLevelOrders",
        "RECORDED_SOURCES",
        "DeliveryChain",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
