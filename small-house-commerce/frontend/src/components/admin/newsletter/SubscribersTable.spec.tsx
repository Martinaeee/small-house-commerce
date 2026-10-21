import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubscribersTable } from "./SubscribersTable";

const apiMock = vi.hoisted(() => ({
  listNewsletterSubscribers: vi.fn(),
  updateNewsletterSubscriber: vi.fn(),
  exportNewsletterSubscribers: vi.fn(),
}));
vi.mock("@/lib/admin-i18n", () => {
  const copy: Record<string, string> = {
    newsletter_subscriber_status: "状态",
    newsletter_subscriber_source: "来源",
    newsletter_filter_all: "全部",
    newsletter_status_subscribed: "已订阅",
    newsletter_status_unsubscribed: "已退订",
    newsletter_source_popup: "弹窗",
    newsletter_source_footer: "页脚",
    newsletter_status_filter: "订阅状态筛选",
    newsletter_source_filter: "订阅来源筛选",
    newsletter_export_csv: "导出 CSV",
    newsletter_exporting: "导出中…",
    newsletter_subscribers_loading: "正在加载订阅者",
    newsletter_subscribers_empty: "没有符合条件的订阅者。",
    newsletter_subscriber_email: "邮箱",
    newsletter_subscribed_at: "订阅时间",
    newsletter_actions: "操作",
    newsletter_unsubscribe: "退订",
    newsletter_restore: "恢复订阅",
    newsletter_processing: "处理中…",
    newsletter_previous: "上一页",
    newsletter_next: "下一页",
  };
  const t = (key: string, vars?: Record<string, string | number>) => {
    if (key === "newsletter_unsubscribe_aria") return `退订 ${vars?.email}`;
    if (key === "newsletter_restore_aria") return `恢复订阅 ${vars?.email}`;
    if (key === "newsletter_total_page") {
      return `共 ${vars?.total} 条 · 第 ${vars?.page}/${vars?.pages} 页`;
    }
    return copy[key] ?? key;
  };
  return { useAdminI18n: () => ({ t }) };
});

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));

const subscriber = {
  id: "subscriber-1",
  email: "shopper@example.com",
  status: "SUBSCRIBED" as const,
  source: "FOOTER" as const,
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
  unsubscribedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listNewsletterSubscribers.mockResolvedValue({
    page: 1,
    pageSize: 20,
    total: 1,
    items: [subscriber],
  });
});

describe("SubscribersTable", () => {
  it("lists subscribers and lets a writer unsubscribe one", async () => {
    const user = userEvent.setup();
    apiMock.updateNewsletterSubscriber.mockResolvedValue({
      ...subscriber,
      status: "UNSUBSCRIBED",
      unsubscribedAt: "2026-10-12T01:00:00.000Z",
    });

    render(<SubscribersTable canWrite />);

    expect(await screen.findByText("shopper@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "退订 shopper@example.com" }));

    await waitFor(() =>
      expect(apiMock.updateNewsletterSubscriber).toHaveBeenCalledWith(
        "subscriber-1",
        "UNSUBSCRIBED",
      ),
    );
    const row = screen.getByText("shopper@example.com").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("已退订")).toBeInTheDocument();
  });

  it("keeps status actions hidden from read-only users", async () => {
    render(<SubscribersTable canWrite={false} />);

    expect(await screen.findByText("shopper@example.com")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "退订 shopper@example.com" }),
    ).toBeNull();
  });

  it("downloads the authenticated CSV export", async () => {
    const user = userEvent.setup();
    apiMock.exportNewsletterSubscribers.mockResolvedValue(
      "email,status\r\nshopper@example.com,SUBSCRIBED",
    );
    const createObjectURL = vi.fn(() => "blob:newsletter-test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );

    render(<SubscribersTable canWrite />);
    await screen.findByText("shopper@example.com");
    await user.click(screen.getByRole("button", { name: "导出 CSV" }));

    await waitFor(() =>
      expect(apiMock.exportNewsletterSubscribers).toHaveBeenCalledTimes(1),
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:newsletter-test");
  });
});
