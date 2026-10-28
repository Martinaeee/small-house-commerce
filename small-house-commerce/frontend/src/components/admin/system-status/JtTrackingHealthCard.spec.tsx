import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminJtTrackingStatus } from "@/lib/admin-api";

const { jtTrackingStatus } = vi.hoisted(() => ({ jtTrackingStatus: vi.fn() }));

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    jtTrackingStatus: (...args: unknown[]) => jtTrackingStatus(...args),
  },
}));

const { JtTrackingHealthCard } = await import("./JtTrackingHealthCard");

const healthy: AdminJtTrackingStatus = {
  enabled: true,
  lastTickAt: "2026-10-28T10:00:00.000Z",
  lastFetched: 3,
  lastFailed: 0,
  pendingShipments: 7,
  lastError: null,
};

const t = ((key: string) => key) as never;

describe("JtTrackingHealthCard", () => {
  beforeEach(() => {
    jtTrackingStatus.mockReset();
    jtTrackingStatus.mockResolvedValue(healthy);
  });

  it("shows the pending count and the title", async () => {
    render(<JtTrackingHealthCard t={t} />);

    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getByText("jt_tracking_title")).toBeInTheDocument();
  });

  it("shows the last error when the worker failed", async () => {
    jtTrackingStatus.mockResolvedValue({
      ...healthy,
      lastFailed: 2,
      lastError: "billCode not found",
    });

    render(<JtTrackingHealthCard t={t} />);

    await waitFor(() =>
      expect(screen.getByText(/billCode not found/)).toBeInTheDocument(),
    );
  });
});
