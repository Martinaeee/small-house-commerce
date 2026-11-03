import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QianyiSettingsPage from "./page";
import { copyText } from "@/lib/clipboard";

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
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

const ROWS = [
  {
    id: "sku-1", skuCode: "TB001-Wa", qianyiSkuCode: "YD003760CMHT", title: "Console Table",
    variantName: "Walnut", imageUrl: "https://cdn.test/table.jpg", ready: true, gaps: [],
  },
  {
    id: "sku-2", skuCode: "SC001", qianyiSkuCode: null, title: "Shelf",
    variantName: "Default", imageUrl: null, ready: false, gaps: ["packageWidth", "productWeight"],
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(copyText).mockResolvedValue(true);
  apiMock.qianyiStatus.mockResolvedValue({ enabled: true, pending: 0, failed: 0, review: 0, skipped: 0, sent24h: 0 });
  apiMock.qianyiSkus.mockResolvedValue(ROWS);
  apiMock.qianyiJobs.mockResolvedValue([]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("QianyiSettingsPage reliability", () => {
  it("shows loading instead of disabled or empty before the requests finish", async () => {
    const loading = deferred<unknown>();
    apiMock.qianyiStatus.mockReturnValue(loading.promise);
    render(<QianyiSettingsPage />);

    expect(screen.getAllByText("qianyi_loading").length).toBeGreaterThan(0);
    expect(screen.queryByText("qianyi_disabled")).not.toBeInTheDocument();
  });

  it("reports a load error and lets the operator refresh", async () => {
    apiMock.qianyiSkus.mockRejectedValueOnce(new Error("offline"));
    render(<QianyiSettingsPage />);

    expect(await screen.findByText("qianyi_load_failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "qianyi_refresh" }));
    expect(await screen.findByText("Console Table")).toBeInTheDocument();
  });

  it("keeps a successful binding when another list read would fail", async () => {
    apiMock.setQianyiMapping.mockResolvedValue({ qianyiSkuCode: "NEW-CODE" });
    apiMock.qianyiSkus.mockResolvedValueOnce(ROWS).mockRejectedValue(new Error("offline"));
    render(<QianyiSettingsPage />);
    const input = await screen.findByLabelText("qianyi code for TB001-Wa");
    await userEvent.clear(input);
    await userEvent.type(input, "NEW-CODE{Enter}");

    expect(await screen.findByText("qianyi_saved")).toBeInTheDocument();
    expect(input).toHaveValue("NEW-CODE");
    expect(screen.queryByText(/qianyi_mapping_failed/)).not.toBeInTheDocument();
  });

  it("locks only the row being saved and updates its bound badge", async () => {
    const saved = deferred<{ qianyiSkuCode: string }>();
    apiMock.setQianyiMapping.mockReturnValue(saved.promise);
    render(<QianyiSettingsPage />);
    const input = await screen.findByLabelText("qianyi code for SC001");
    await userEvent.type(input, "Q-SHELF{Enter}");

    expect(input).toBeDisabled();
    expect(screen.getByLabelText("qianyi code for TB001-Wa")).not.toBeDisabled();
    saved.resolve({ qianyiSkuCode: "Q-SHELF" });
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(within(input.closest("tr")!).getByText("qianyi_bind_bound")).toBeInTheDocument();
    expect(apiMock.setQianyiMapping).toHaveBeenCalledTimes(1);
  });
});

describe("QianyiSettingsPage overview", () => {
  it("shows the binding progress, the webhook URL and the operator guide", async () => {
    render(<QianyiSettingsPage />);

    expect(await screen.findByText(/qianyi_bound_progress/)).toBeInTheDocument();
    expect(screen.getByText(/luwag\.shop\/api\/v1\/qianyi\/webhook/)).toBeInTheDocument();
    expect(screen.getByText("qianyi_guide_title")).toBeInTheDocument();
  });

  it("copies the webhook URL", async () => {
    render(<QianyiSettingsPage />);
    await userEvent.click(screen.getByText("qianyi_guide_title"));
    await userEvent.click(await screen.findByRole("button", { name: "qianyi_copy_webhook" }));

    expect(copyText).toHaveBeenCalledWith("https://luwag.shop/api/v1/qianyi/webhook");
    expect(await screen.findByText("qianyi_copied")).toBeInTheDocument();
  });

  it("surfaces late callbacks that need a human", async () => {
    apiMock.qianyiStatus.mockResolvedValue({ enabled: true, pending: 0, failed: 1, review: 0, skipped: 0, sent24h: 3, callbacks: 2 });
    render(<QianyiSettingsPage />);

    expect(await screen.findByText(/qianyi_callbacks/)).toBeInTheDocument();
  });
});

describe("QianyiSettingsPage SKU table", () => {
  it("lists SKU codes and data gaps without offering remote creation", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());
    expect(screen.getByText("TB001-Wa")).toBeInTheDocument();
    expect(screen.getByText(/qianyi_missing/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("draws the variant thumbnail and a placeholder when there is no photo", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());

    expect(screen.getByAltText(/TB001-Wa/)).toHaveAttribute("src", "https://cdn.test/table.jpg");
    expect(screen.getByLabelText(/qianyi_no_photo/)).toBeInTheDocument();
  });

  it("filters rows by name, SKU code or Qianyi code", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());

    const search = screen.getByPlaceholderText("qianyi_search_placeholder");
    await userEvent.type(search, "YD003760");

    expect(screen.getByText("Console Table")).toBeInTheDocument();
    expect(screen.queryByText("Shelf")).not.toBeInTheDocument();
  });

  it("filters to unmapped rows only", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "qianyi_filter_unmapped" }));

    expect(screen.getByText("Shelf")).toBeInTheDocument();
    expect(screen.queryByText("Console Table")).not.toBeInTheDocument();
  });

  it("filters to rows whose Qianyi data is incomplete", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "qianyi_filter_gaps" }));

    expect(screen.getByText("Shelf")).toBeInTheDocument();
    expect(screen.queryByText("Console Table")).not.toBeInTheDocument();
  });

  it("copies the unmapped SKU list for the Qianyi operator", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Console Table")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "qianyi_copy_unmapped" }));

    expect(copyText).toHaveBeenCalledWith("SC001 — Shelf — Default");
    expect(await screen.findByText(/qianyi_copied_unmapped/)).toBeInTheDocument();
  });

  it("expands the missing field names with the Qianyi hint", async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText("Shelf")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /qianyi_missing/ }));

    expect(screen.getByText(/qianyi_gap_packageWidth/)).toBeInTheDocument();
    expect(screen.getByText(/qianyi_gap_productWeight/)).toBeInTheDocument();
    expect(screen.getByText(/qianyi_gap_hint/)).toBeInTheDocument();
  });
});

describe("QianyiSettingsPage mapping", () => {
  it("saves a manually entered Qianyi code", async () => {
    apiMock.setQianyiMapping.mockResolvedValue({ qianyiSkuCode: "YD999" });
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText("qianyi code for TB001-Wa")).toBeInTheDocument());

    const input = screen.getByLabelText("qianyi code for TB001-Wa");
    await userEvent.clear(input);
    await userEvent.type(input, "YD999");
    await userEvent.tab();

    expect(apiMock.setQianyiMapping).toHaveBeenCalledWith("sku-1", "YD999");
  });

  it("reverts the input and names the reason when the code is rejected", async () => {
    apiMock.setQianyiMapping.mockRejectedValue(new Error("not found"));
    render(<QianyiSettingsPage />);

    const input = await screen.findByLabelText("qianyi code for TB001-Wa");
    await userEvent.clear(input);
    await userEvent.type(input, "NOPE");
    await userEvent.tab();

    await waitFor(() => expect(input).toHaveValue("YD003760CMHT"));
    expect(await screen.findByText(/qianyi_mapping_failed/)).toBeInTheDocument();
  });
});

describe("QianyiSettingsPage jobs", () => {
  const job = (overrides: Record<string, unknown>) => ({
    id: "job-1",
    kind: "PUSH_ORDER",
    status: "SENT",
    attempts: 1,
    pendingReview: false,
    lastError: null,
    externalOrderNumber: null,
    updatedAt: "2026-10-29T00:00:00.000Z",
    order: { id: "order-1", orderNumber: "PH100013" },
    ...overrides,
  });

  it("shows an empty state before any order was pushed", async () => {
    render(<QianyiSettingsPage />);

    expect(await screen.findByText("qianyi_jobs_empty")).toBeInTheDocument();
  });

  it("defaults to actionable jobs and can switch to the full history", async () => {
    apiMock.qianyiJobs.mockResolvedValue([
      job({ id: "job-a", order: { id: "order-a", orderNumber: "PH100013" } }),
      job({ id: "job-b", status: "FAILED", pendingReview: false, lastError: "邮编为空", order: { id: "order-b", orderNumber: "PH100014" } }),
    ]);
    render(<QianyiSettingsPage />);

    await screen.findByText("PH100014");
    expect(screen.queryByText("PH100013")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "qianyi_jobs_filter_all" }));

    expect(screen.getByText("PH100013")).toBeInTheDocument();
  });

  it("links the order number to the order workbench", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ id: "job-b", status: "FAILED", order: { id: "order-b", orderNumber: "PH100014" } })]);
    render(<QianyiSettingsPage />);

    expect(await screen.findByRole("link", { name: "PH100014" })).toHaveAttribute("href", "/admin/orders/order-b");
  });

  it("offers a safe retry only when no create was dispatched", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ id: "job-7", status: "FAILED", pendingReview: false, lastError: "OUTCOME_UNKNOWN", order: { id: "order-1", orderNumber: "PH100013" } })]);
    apiMock.retryQianyiJob.mockResolvedValue({ ok: true });
    render(<QianyiSettingsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /^qianyi_retry$/ }));

    expect(apiMock.retryQianyiJob).toHaveBeenCalledWith("job-7");
    expect(apiMock.authorizeQianyiCreateRetry).not.toHaveBeenCalled();
  });

  it("never offers a plain retry for a create with an unknown outcome", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ id: "job-7", status: "FAILED", pendingReview: true, lastError: "OUTCOME_UNKNOWN", attempts: 1, order: { id: "order-1", orderNumber: "PH100013" } })]);
    render(<QianyiSettingsPage />);

    expect(await screen.findByRole("button", { name: /qianyi_authorize_retry/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^qianyi_retry$/ })).not.toBeInTheDocument();
  });

  it("authorizes a create retry only through the explicit confirmation", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ id: "job-7", status: "FAILED", pendingReview: true, lastError: "OUTCOME_UNKNOWN", order: { id: "order-1", orderNumber: "PH100013" } })]);
    apiMock.authorizeQianyiCreateRetry.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QianyiSettingsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /qianyi_authorize_retry/ }));

    expect(confirm).toHaveBeenCalled();
    expect(apiMock.authorizeQianyiCreateRetry).toHaveBeenCalledWith("job-7");
    expect(apiMock.retryQianyiJob).not.toHaveBeenCalled();
  });

  it("adopts an existing Qianyi order with the number typed next to the job", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ id: "job-7", status: "FAILED", pendingReview: true, lastError: "OUTCOME_UNKNOWN", order: { id: "order-1", orderNumber: "PH100013" } })]);
    apiMock.adoptQianyiJob.mockResolvedValue({ ok: true });
    render(<QianyiSettingsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /qianyi_adopt$/ }));
    const input = screen.getByPlaceholderText("qianyi_adopt_placeholder");
    await userEvent.type(input, " QY-7 ");
    await userEvent.click(screen.getByRole("button", { name: "qianyi_adopt_submit" }));

    expect(apiMock.adoptQianyiJob).toHaveBeenCalledWith("job-7", "QY-7");
    expect(await screen.findByText(/qianyi_adopted/)).toBeInTheDocument();
  });

  it("offers a requeue for a skipped job and reports the SKUs still unmapped", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({
      id: "job-9", status: "SKIPPED", attempts: 0, lastError: "No Qianyi code for TB001-Wa.",
      order: { id: "order-9", orderNumber: "PH100012" },
    })]);
    apiMock.requeueQianyiJob.mockResolvedValue({ ok: false, missing: ["TB001-Wa"] });
    render(<QianyiSettingsPage />);

    const button = await screen.findByRole("button", { name: /qianyi_requeue/ });
    await userEvent.click(button);

    expect(apiMock.requeueQianyiJob).toHaveBeenCalledWith("job-9");
    expect(await screen.findByText(/qianyi_requeue_blocked/)).toBeInTheDocument();
  });

  it("filters jobs from the clickable overview counts", async () => {
    apiMock.qianyiJobs.mockResolvedValue([
      job({ id: "failed", status: "FAILED", order: { id: "o1", orderNumber: "PH-FAILED" } }),
      job({ id: "skipped", status: "SKIPPED", order: { id: "o2", orderNumber: "PH-SKIPPED" } }),
    ]);
    render(<QianyiSettingsPage />);
    await screen.findByText("PH-SKIPPED");

    await userEvent.click(screen.getByRole("button", { name: "qianyi_skipped" }));

    expect(screen.getByText("PH-SKIPPED")).toBeInTheDocument();
    expect(screen.queryByText("PH-FAILED")).not.toBeInTheDocument();
    expect(apiMock.qianyiJobs).toHaveBeenLastCalledWith("skipped");
  });

  it("prevents duplicate retries while a job action is pending", async () => {
    const pending = deferred<{ ok: boolean }>();
    apiMock.qianyiJobs.mockResolvedValue([job({ status: "FAILED" })]);
    apiMock.retryQianyiJob.mockReturnValue(pending.promise);
    render(<QianyiSettingsPage />);
    const button = await screen.findByRole("button", { name: /^qianyi_retry$/ });

    await userEvent.click(button);
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(apiMock.retryQianyiJob).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true });
    expect(await screen.findByText("qianyi_retried")).toBeInTheDocument();
  });

  it("surfaces a job action failure without losing the job or leaving the button locked", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ status: "FAILED" })]);
    apiMock.retryQianyiJob.mockRejectedValue(new Error("offline"));
    render(<QianyiSettingsPage />);
    const button = await screen.findByRole("button", { name: /^qianyi_retry$/ });
    await userEvent.click(button);

    expect(await screen.findByText("qianyi_action_failed")).toBeInTheDocument();
    expect(screen.getByText("PH100013")).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("keeps the adoption input open when Qianyi refuses the number", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ status: "FAILED", pendingReview: true })]);
    apiMock.adoptQianyiJob.mockResolvedValue({ ok: false, reason: "order not found" });
    render(<QianyiSettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /^qianyi_adopt$/ }));
    const input = screen.getByPlaceholderText("qianyi_adopt_placeholder");
    await userEvent.type(input, "WRONG");
    await userEvent.click(screen.getByRole("button", { name: "qianyi_adopt_submit" }));

    expect(await screen.findByText("qianyi_adopt_blocked")).toBeInTheDocument();
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("WRONG");
  });

  it("shows the full error text when the row is expanded", async () => {
    apiMock.qianyiJobs.mockResolvedValue([job({ id: "job-b", status: "FAILED", lastError: "邮编为空; verify the outcome in Qianyi before retrying", order: { id: "order-b", orderNumber: "PH100014" } })]);
    render(<QianyiSettingsPage />);

    const row = (await screen.findByText("PH100014")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "qianyi_col_error" }));

    expect(screen.getByText("邮编为空; verify the outcome in Qianyi before retrying")).toBeInTheDocument();
  });
});
