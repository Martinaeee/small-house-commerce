import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackInStockTable } from "./BackInStockTable";

const apiMock = vi.hoisted(() => ({
  listBackInStockSubscriptions: vi.fn(),
  resendBackInStockSubscription: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));
vi.mock("@/lib/admin-i18n", () => {
  const copy: Record<string, string> = {
    newsletter_filter_all: "全部",
    newsletter_back_in_stock_status_filter: "有货通知状态筛选",
    newsletter_back_in_stock_status_PENDING: "待发送",
    newsletter_back_in_stock_status_SENT: "已发送",
    newsletter_back_in_stock_status_CANCELLED: "已取消",
    newsletter_back_in_stock_loading: "正在加载有货通知",
    newsletter_back_in_stock_load_failed: "无法加载有货通知。",
    newsletter_back_in_stock_empty: "没有符合条件的有货通知。",
    newsletter_subscriber_email: "邮箱",
    newsletter_back_in_stock_product: "商品 / 款式",
    newsletter_back_in_stock_sku: "SKU",
    newsletter_subscriber_status: "状态",
    newsletter_back_in_stock_created_at: "登记时间",
    newsletter_back_in_stock_notified_at: "通知时间",
    newsletter_back_in_stock_error: "错误",
    newsletter_actions: "操作",
    newsletter_back_in_stock_resend: "重发",
    newsletter_processing: "处理中…",
    newsletter_previous: "上一页",
    newsletter_next: "下一页",
    newsletter_back_in_stock_resend_failed: "重发失败。",
  };
  const t = (key: string, vars?: Record<string, string | number>) => {
    if (key === "newsletter_back_in_stock_resend_aria") {
      return `重发 ${vars?.email}`;
    }
    if (key === "newsletter_total_page") {
      return `共 ${vars?.total} 条 · 第 ${vars?.page}/${vars?.pages} 页`;
    }
    return copy[key] ?? key;
  };
  return { useAdminI18n: () => ({ t }) };
});

const rows = [
  {
    id: "alert-pending",
    email: "pending@example.com",
    skuId: "sku-pending",
    status: "PENDING" as const,
    productName: "Luna Chair",
    productSlug: "luna-chair",
    skuCode: "LUNA-BLUE",
    variantName: "Blue",
    lastError: "provider unavailable",
    notifiedAt: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T01:00:00.000Z",
  },
  {
    id: "alert-sent",
    email: "sent@example.com",
    skuId: "sku-sent",
    status: "SENT" as const,
    productName: "Maya Table",
    productSlug: "maya-table",
    skuCode: "MAYA-OAK",
    variantName: "Oak",
    lastError: null,
    notifiedAt: "2026-10-12T02:00:00.000Z",
    createdAt: "2026-10-11T23:00:00.000Z",
    updatedAt: "2026-10-12T02:00:00.000Z",
  },
  {
    id: "alert-cancelled",
    email: "cancelled@example.com",
    skuId: "sku-cancelled",
    status: "CANCELLED" as const,
    productName: "Nara Shelf",
    productSlug: "nara-shelf",
    skuCode: "NARA-WALNUT",
    variantName: "Walnut",
    lastError: null,
    notifiedAt: null,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T01:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listBackInStockSubscriptions.mockResolvedValue({
    page: 1,
    pageSize: 20,
    total: rows.length,
    items: rows,
  });
});

describe("BackInStockTable", () => {
  it("loads all statuses with product, SKU, error and timestamp details", async () => {
    render(<BackInStockTable canWrite />);

    expect(await screen.findByText("pending@example.com")).toBeInTheDocument();
    expect(apiMock.listBackInStockSubscriptions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    });
    const pendingRow = screen.getByText("pending@example.com").closest("tr")!;
    expect(within(pendingRow).getByText("Luna Chair")).toBeVisible();
    expect(within(pendingRow).getByText("Blue")).toBeVisible();
    expect(within(pendingRow).getByText("LUNA-BLUE")).toBeVisible();
    expect(within(pendingRow).getByText("待发送")).toBeVisible();
    expect(within(pendingRow).getByText("provider unavailable")).toBeVisible();
    expect(pendingRow).toHaveTextContent(
      new Date(rows[0].createdAt).toLocaleString(),
    );

    const sentRow = screen.getByText("sent@example.com").closest("tr")!;
    expect(within(sentRow).getByText("已发送")).toBeVisible();
    expect(sentRow).toHaveTextContent(
      new Date(rows[1].notifiedAt!).toLocaleString(),
    );
    expect(
      within(screen.getByText("cancelled@example.com").closest("tr")!).getByText(
        "已取消",
      ),
    ).toBeVisible();
  });

  it("filters by status and returns to the first page", async () => {
    const user = userEvent.setup();
    render(<BackInStockTable canWrite />);
    await screen.findByText("pending@example.com");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "有货通知状态筛选" }),
      "SENT",
    );

    await waitFor(() =>
      expect(apiMock.listBackInStockSubscriptions).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        status: "SENT",
      }),
    );
  });

  it("locks duplicate resend requests and replaces the row with the response", async () => {
    let resolve!: (value: (typeof rows)[number]) => void;
    apiMock.resendBackInStockSubscription.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<BackInStockTable canWrite />);
    await screen.findByText("pending@example.com");
    const resend = screen.getByRole("button", {
      name: "重发 pending@example.com",
    });

    act(() => {
      fireEvent.click(resend);
      fireEvent.click(resend);
    });

    expect(apiMock.resendBackInStockSubscription).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "重发 pending@example.com" })).toBeDisabled();
    await act(async () =>
      resolve({
        ...rows[0],
        status: "SENT",
        lastError: null,
        notifiedAt: "2026-10-12T03:00:00.000Z",
      }),
    );
    expect(
      within(screen.getByText("pending@example.com").closest("tr")!).getByText(
        "已发送",
      ),
    ).toBeVisible();
  });

  it("hides resend actions without NEWSLETTER_WRITE", async () => {
    render(<BackInStockTable canWrite={false} />);

    expect(await screen.findByText("pending@example.com")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重发 pending@example.com" }),
    ).toBeNull();
    expect(screen.queryByText("操作")).toBeNull();
  });

  it("loads the next page without losing the active status filter", async () => {
    const user = userEvent.setup();
    apiMock.listBackInStockSubscriptions.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 21,
      items: rows,
    });
    render(<BackInStockTable canWrite />);
    await screen.findByText("pending@example.com");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "有货通知状态筛选" }),
      "PENDING",
    );
    await user.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() =>
      expect(apiMock.listBackInStockSubscriptions).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 20,
        status: "PENDING",
      }),
    );
  });
});
