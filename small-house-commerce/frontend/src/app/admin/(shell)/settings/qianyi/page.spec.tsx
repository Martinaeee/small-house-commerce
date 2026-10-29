import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QianyiSettingsPage from "./page";

const apiMock = vi.hoisted(() => ({
  qianyiStatus: vi.fn(),
  qianyiSkus: vi.fn(),
  qianyiJobs: vi.fn(),
  createQianyiSkus: vi.fn(),
  retryQianyiJob: vi.fn(),
  requeueQianyiJob: vi.fn(),
  setQianyiMapping: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key, lang: "en", setLang: () => {} }),
}));

const ROWS = [
  { id: "sku-1", skuCode: "TB001-Wa", qianyiSkuCode: null, title: "Console Table", ready: true, gaps: [] },
  { id: "sku-2", skuCode: "SC001", qianyiSkuCode: null, title: "Shelf", ready: false, gaps: ["packageWidth"] },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.qianyiStatus.mockResolvedValue({ enabled: true, pending: 0, failed: 1, sent24h: 3 });
  apiMock.qianyiSkus.mockResolvedValue(ROWS);
  apiMock.qianyiJobs.mockResolvedValue([]);
});

describe("QianyiSettingsPage", () => {
  it("disables rows that are not ready to be created", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());
    expect(screen.getByLabelText("TB001-Wa")).toBeEnabled();
    expect(screen.getByLabelText("SC001")).toBeDisabled();
  });

  it("starts with nothing selected", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("TB001-Wa")).toBeInTheDocument());
    expect(screen.getByLabelText("TB001-Wa")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /qianyi_create_selected/ })).toBeDisabled();
  });

  it("submits only the ticked rows", async () => {
    apiMock.createQianyiSkus.mockResolvedValue({ results: [{ skuCode: "TB001-Wa", ok: true }] });
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("TB001-Wa")).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText("TB001-Wa"));
    await userEvent.click(screen.getByRole("button", { name: /qianyi_create_selected/ }));

    expect(apiMock.createQianyiSkus).toHaveBeenCalledWith(["sku-1"]);
  });
});

describe("QianyiSettingsPage mapping", () => {
  it("saves a manually entered Qianyi code", async () => {
    apiMock.qianyiSkus.mockResolvedValue(ROWS);
    apiMock.setQianyiMapping.mockResolvedValue({ qianyiSkuCode: "YD003760CMHT" });
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("TB001-Wa")).toBeInTheDocument());

    const input = screen.getByLabelText("qianyi code for TB001-Wa");
    await userEvent.type(input, "YD003760CMHT");
    await userEvent.tab();

    expect(apiMock.setQianyiMapping).toHaveBeenCalledWith("sku-1", "YD003760CMHT");
  });
});

describe("QianyiSettingsPage skipped jobs", () => {
  it("offers a requeue for a skipped job and reports the SKUs still unmapped", async () => {
    apiMock.qianyiJobs.mockResolvedValue([
      {
        id: "job-9",
        kind: "PUSH_ORDER",
        status: "SKIPPED",
        attempts: 0,
        lastError: "No Qianyi code for TB001-Wa.",
        externalOrderNumber: null,
        updatedAt: "2026-10-28T00:00:00.000Z",
        order: { orderNumber: "PH100012" },
      },
    ]);
    apiMock.requeueQianyiJob.mockResolvedValue({ ok: false, missing: ["TB001-Wa"] });
    render(<QianyiSettingsPage />);

    const button = await screen.findByRole("button", { name: /qianyi_requeue/ });
    await userEvent.click(button);

    expect(apiMock.requeueQianyiJob).toHaveBeenCalledWith("job-9");
    expect(await screen.findByText(/qianyi_requeue_blocked/)).toBeInTheDocument();
  });
});
