import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromotionPanel } from "./PromotionPanel";

const apiMock = vi.hoisted(() => ({
  listNewsletterPromotions: vi.fn(),
  getNewsletterPromotionUsage: vi.fn(),
  createNewsletterPromotion: vi.fn(),
  updateNewsletterPromotion: vi.fn(),
}));

vi.mock("@/lib/admin-i18n", () => {
  const copy: Record<string, string> = {
    newsletter_no_active_offer:
      "当前没有生效中的订阅优惠，前台不会展示优惠承诺。",
    newsletter_start_round: "开始新一轮",
    newsletter_round_warning:
      "开始新一轮会归档当前活动；旧活动、历史计数与核销数据会永久保留。",
    newsletter_promo_code: "优惠码",
    newsletter_promo_value: "优惠数值",
    newsletter_promo_save: "保存活动",
    newsletter_promo_create_round: "创建并开始新一轮",
    newsletter_promo_code_invalid:
      "优惠码需为 3–32 位大写字母、数字或连字符。",
    newsletter_promo_percent_invalid: "百分比优惠不能超过 100。",
    newsletter_offer_status_EXHAUSTED:
      "当前活动使用次数已耗尽，前台不会展示优惠承诺。",
  };
  const t = (key: string) => copy[key] ?? key;
  return { useAdminI18n: () => ({ t }) };
});

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));

const active = {
  id: "promo-1",
  code: "WELCOME10",
  discountType: "PERCENT" as const,
  discountValue: "10.00",
  minSpend: "0.00",
  maxUses: 100,
  perCustomerLimit: 1,
  validFrom: null,
  validUntil: null,
  status: "ACTIVE" as const,
  archivedAt: null,
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getNewsletterPromotionUsage.mockResolvedValue({
    promotionId: "promo-1",
    effective: 4,
    released: 1,
    maxUses: 100,
    perCustomerLimit: 1,
    availability: "LIVE",
  });
});

describe("PromotionPanel", () => {
  it("states that the storefront shows no offer when there is no active promotion", async () => {
    apiMock.listNewsletterPromotions.mockResolvedValue([]);

    render(<PromotionPanel />);

    expect(
      await screen.findByText("当前没有生效中的订阅优惠，前台不会展示优惠承诺。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始新一轮" })).toBeVisible();
  });

  it("warns when the active promotion is exhausted and not storefront-available", async () => {
    apiMock.listNewsletterPromotions.mockResolvedValue([active]);
    apiMock.getNewsletterPromotionUsage.mockResolvedValue({
      promotionId: active.id,
      effective: 100,
      released: 0,
      maxUses: 100,
      perCustomerLimit: 1,
      availability: "EXHAUSTED",
    });

    render(<PromotionPanel />);

    expect(
      await screen.findByText(
        "当前活动使用次数已耗尽，前台不会展示优惠承诺。",
      ),
    ).toBeInTheDocument();
  });

  it("rejects an invalid code without calling the API", async () => {
    const user = userEvent.setup();
    apiMock.listNewsletterPromotions.mockResolvedValue([active]);
    render(<PromotionPanel />);

    const code = await screen.findByLabelText("优惠码");
    await user.clear(code);
    await user.type(code, "bad code");
    await user.click(screen.getByRole("button", { name: "保存活动" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "优惠码需为 3–32 位大写字母、数字或连字符。",
    );
    expect(apiMock.updateNewsletterPromotion).not.toHaveBeenCalled();
  });

  it("rejects a percentage above 100 without calling the API", async () => {
    const user = userEvent.setup();
    apiMock.listNewsletterPromotions.mockResolvedValue([active]);
    render(<PromotionPanel />);

    const value = await screen.findByLabelText("优惠数值");
    await user.clear(value);
    await user.type(value, "120");
    await user.click(screen.getByRole("button", { name: "保存活动" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "百分比优惠不能超过 100。",
    );
    expect(apiMock.updateNewsletterPromotion).not.toHaveBeenCalled();
  });

  it("warns that a new round archives but preserves the old history", async () => {
    const user = userEvent.setup();
    apiMock.listNewsletterPromotions.mockResolvedValue([active]);
    render(<PromotionPanel />);

    await user.click(
      await screen.findByRole("button", { name: "开始新一轮" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "开始新一轮会归档当前活动；旧活动、历史计数与核销数据会永久保留。",
      ),
    );
    expect(screen.getByRole("button", { name: "创建并开始新一轮" })).toBeVisible();
  });
});
