import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { zh } from "@/i18n/zh";
import type { AdminI18n } from "@/lib/admin-i18n";
import type { AdminSystemStatus } from "@/lib/admin-api";
import { SystemStatusView } from "./SystemStatusView";

const t: AdminI18n["t"] = (key, vars) => {
  const template = (zh as Record<string, string>)[key] ?? String(key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
};

const healthy: AdminSystemStatus = {
  generatedAt: "2026-10-27T10:00:00.000Z",
  stale: false,
  certificate: {
    subject: "CN=luwag.shop",
    san: ["luwag.shop", "www.luwag.shop"],
    notAfter: "Jan 22 04:59:59 2027 GMT",
    daysRemaining: 87,
    keyMatches: true,
    served: {
      reachable: true,
      notAfter: "Jan 22 04:59:59 2027 GMT",
      daysRemaining: 86,
    },
  },
  services: [
    { name: "caddy", status: "running", restarts: 0 },
    { name: "db", status: "running", restarts: 0 },
  ],
  disk: { usedPercent: 19, availableBytes: 66_000_000_000, totalBytes: 85_000_000_000 },
  backup: { latestFile: "small_house-20261027.sql.gz", ageHours: 1, ok: true },
  database: { reachable: true, sizePretty: "15 MB", migrations: 69 },
  uploads: { files: 1284, pretty: "890 MB" },
  alert: { lastResult: "OK", lastCheckAt: "2026-10-27T09:07:00.000Z" },
};

function certificateCard(container: HTMLElement): HTMLElement {
  const heading = container.querySelector("h2");
  const card = heading?.closest("section");
  if (!card) throw new Error("certificate card not found");
  return card as HTMLElement;
}

describe("SystemStatusView", () => {
  it("renders the host snapshot cards", () => {
    render(
      <SystemStatusView data={healthy} error={null} loading={false} onRefresh={() => {}} t={t} />,
    );

    expect(screen.getByRole("heading", { name: "证书" })).toBeVisible();
    expect(screen.getByText("剩余 86 天")).toBeVisible();
    expect(screen.getByText("caddy")).toBeVisible();
    expect(screen.getByText("迁移 69 条")).toBeVisible();
    expect(screen.getByText("1284 个文件")).toBeVisible();
    expect(screen.getByText(/small_house-20261027/)).toBeVisible();
  });

  it("shows the certificate expiry date in local time", () => {
    render(
      <SystemStatusView data={healthy} error={null} loading={false} onRefresh={() => {}} t={t} />,
    );

    expect(screen.getByText("到期时间")).toBeVisible();
    expect(screen.getByText("2027-01-22 12:59 (GMT+8)")).toBeVisible();
  });

  it("counts down to the soonest expiry when the served certificate expires first", () => {
    render(
      <SystemStatusView
        data={{
          ...healthy,
          certificate: {
            ...healthy.certificate!,
            daysRemaining: 87,
            served: {
              reachable: true,
              notAfter: "Jan 15 04:59:59 2027 GMT",
              daysRemaining: 80,
            },
          },
        }}
        error={null}
        loading={false}
        onRefresh={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText("剩余 80 天")).toBeVisible();
    expect(screen.getByText("2027-01-15 12:59 (GMT+8)")).toBeVisible();
  });

  it("turns the certificate card red exactly one week before expiry", () => {
    const { container } = render(
      <SystemStatusView
        data={{
          ...healthy,
          certificate: {
            ...healthy.certificate!,
            daysRemaining: 7,
            served: { reachable: true, daysRemaining: 7 },
          },
        }}
        error={null}
        loading={false}
        onRefresh={() => {}}
        t={t}
      />,
    );

    expect(certificateCard(container).getAttribute("data-tone")).toBe("critical");
  });

  it("keeps the certificate card out of the red zone with more than a week left", () => {
    const { container } = render(
      <SystemStatusView
        data={{
          ...healthy,
          certificate: {
            ...healthy.certificate!,
            daysRemaining: 8,
            served: { reachable: true, daysRemaining: 8 },
          },
        }}
        error={null}
        loading={false}
        onRefresh={() => {}}
        t={t}
      />,
    );

    expect(certificateCard(container).getAttribute("data-tone")).toBe("warning");
  });

  it("marks a certificate close to expiry as critical", () => {
    const { container } = render(
      <SystemStatusView
        data={{
          ...healthy,
          certificate: { ...healthy.certificate!, daysRemaining: 5 },
        }}
        error={null}
        loading={false}
        onRefresh={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText("剩余 5 天")).toBeVisible();
    expect(container.querySelector('[data-tone="critical"]')).not.toBeNull();
  });

  it("shows the stale banner when the snapshot is old", () => {
    render(
      <SystemStatusView
        data={{ ...healthy, stale: true }}
        error={null}
        loading={false}
        onRefresh={() => {}}
        t={t}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "数据已超过 15 分钟未更新",
    );
  });

  it("shows an unavailable state and retries", () => {
    const onRefresh = vi.fn();
    render(
      <SystemStatusView
        data={null}
        error="unavailable"
        loading={false}
        onRefresh={onRefresh}
        t={t}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "状态不可用：宿主机采集脚本尚未运行",
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
