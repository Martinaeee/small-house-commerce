import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QianyiSettingsPage from "./page";

const apiMock = vi.hoisted(() => ({
  qianyiStatus: vi.fn(),
  qianyiSkus: vi.fn(),
  qianyiJobs: vi.fn(),
  retryQianyiJob: vi.fn(),
  requeueQianyiJob: vi.fn(),
  authorizeQianyiCreateRetry: vi.fn(),
  adoptQianyiJob: vi.fn(),
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
  apiMock.qianyiStatus.mockResolvedValue({ enabled: true, pending: 0, failed: 1, review: 0, sent24h: 3 });
  apiMock.qianyiSkus.mockResolvedValue(ROWS);
  apiMock.qianyiJobs.mockResolvedValue([]);
});

describe("QianyiSettingsPage", () => {
  it("lists SKU codes and data gaps without offering remote creation", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());
    expect(screen.getByText("TB001-Wa")).toBeInTheDocument();
    expect(screen.getByText(/qianyi_missing/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("QianyiSettingsPage mapping", () => {
  it("saves a manually entered Qianyi code", async () => {
    apiMock.qianyiSkus.mockResolvedValue(ROWS);
    apiMock.setQianyiMapping.mockResolvedValue({ qianyiSkuCode: "YD003760CMHT" });
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("qianyi code for TB001-Wa")).toBeInTheDocument());

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
        pendingReview: false,
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

  const failedJob = (pendingReview: boolean) => ({
    id: "job-7",
    kind: "PUSH_ORDER",
    status: "FAILED",
    attempts: 1,
    pendingReview,
    lastError: "OUTCOME_UNKNOWN",
    externalOrderNumber: null,
    updatedAt: "2026-10-29T00:00:00.000Z",
    order: { orderNumber: "PH100013" },
  });

  it("never offers a plain retry for a create with an unknown outcome", async () => {
    apiMock.qianyiJobs.mockResolvedValue([failedJob(true)]);
    render(<QianyiSettingsPage />);

    expect(await screen.findByRole("button", { name: /qianyi_authorize_retry/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^qianyi_retry$/ })).not.toBeInTheDocument();
  });

  it("authorizes a create retry only through the explicit confirmation", async () => {
    apiMock.qianyiJobs.mockResolvedValue([failedJob(true)]);
    apiMock.authorizeQianyiCreateRetry.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QianyiSettingsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /qianyi_authorize_retry/ }));

    expect(confirm).toHaveBeenCalled();
    expect(apiMock.authorizeQianyiCreateRetry).toHaveBeenCalledWith("job-7");
    expect(apiMock.retryQianyiJob).not.toHaveBeenCalled();
  });

  it("offers a safe retry only when no create was dispatched", async () => {
    apiMock.qianyiJobs.mockResolvedValue([failedJob(false)]);
    apiMock.retryQianyiJob.mockResolvedValue({ ok: true });
    render(<QianyiSettingsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /^qianyi_retry$/ }));

    expect(apiMock.retryQianyiJob).toHaveBeenCalledWith("job-7");
    expect(apiMock.authorizeQianyiCreateRetry).not.toHaveBeenCalled();
  });

  it("adopts an existing Qianyi order with the number the operator found", async () => {
    apiMock.qianyiJobs.mockResolvedValue([failedJob(true)]);
    apiMock.adoptQianyiJob.mockResolvedValue({ ok: true });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(" QY-7 ");
    render(<QianyiSettingsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /qianyi_adopt/ }));

    expect(prompt).toHaveBeenCalled();
    expect(apiMock.adoptQianyiJob).toHaveBeenCalledWith("job-7", "QY-7");
  });

  it("surfaces late callbacks that need a human", async () => {
    apiMock.qianyiStatus.mockResolvedValue({ enabled: true, pending: 0, failed: 1, review: 0, sent24h: 3, callbacks: 2 });
    render(<QianyiSettingsPage />);

    expect(await screen.findByText(/qianyi_callbacks/)).toBeInTheDocument();
  });
});
