import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SiteSettingsPage from "./page";

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));

const settings = {
  id: "settings-1",
  messengerUrl: "https://m.me/luwag",
  supportEmail: "help@luwag.test",
  supportPhone: "+63 917 123 4567",
  supportHours: "Mon-Sat",
  newsletterBandEnabled: true,
  newsletterPopupEnabled: false,
  newsletterPopupDelaySeconds: 5,
  newsletterOfferTitle: "Subscribe and save",
  newsletterOfferBody: "Welcome to LUWAG.",
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getSettings.mockResolvedValue(settings);
  apiMock.updateSettings.mockResolvedValue({
    ...settings,
    newsletterPopupEnabled: true,
    newsletterPopupDelaySeconds: 8,
    newsletterOfferTitle: "Join and save",
  });
});

describe("SiteSettingsPage newsletter fields", () => {
  it("loads and saves Messenger and newsletter settings without support fields", async () => {
    const user = userEvent.setup();
    render(<SiteSettingsPage />);

    const band = await screen.findByLabelText(/启用页脚上方订阅通栏/);
    const popup = screen.getByLabelText(/启用首访优惠弹窗/);
    expect(band).toBeChecked();
    expect(popup).not.toBeChecked();
    expect(screen.getByLabelText(/弹窗延迟（秒）/)).toHaveValue(5);
    expect(screen.getByLabelText(/优惠标题/)).toHaveValue("Subscribe and save");
    expect(screen.getByLabelText(/优惠正文/)).toHaveValue("Welcome to LUWAG.");

    await user.click(popup);
    await user.clear(screen.getByLabelText(/弹窗延迟（秒）/));
    await user.type(screen.getByLabelText(/弹窗延迟（秒）/), "8");
    await user.clear(screen.getByLabelText(/优惠标题/));
    await user.type(screen.getByLabelText(/优惠标题/), "Join and save");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(apiMock.updateSettings).toHaveBeenCalledWith({
        messengerUrl: "https://m.me/luwag",
        newsletterBandEnabled: true,
        newsletterPopupEnabled: true,
        newsletterPopupDelaySeconds: 8,
        newsletterOfferTitle: "Join and save",
        newsletterOfferBody: "Welcome to LUWAG.",
      }),
    );
  });
});

describe("SiteSettingsPage contact handoff", () => {
  it("shows the published contact values read-only and links to the footer editor", async () => {
    render(<SiteSettingsPage />);

    await screen.findByLabelText(/启用页脚上方订阅通栏/);

    expect(screen.queryByLabelText(/客服电话/)).toBeNull();
    expect(screen.queryByLabelText(/客服邮箱/)).toBeNull();
    expect(screen.queryByLabelText(/服务时间/)).toBeNull();
    expect(screen.getByText("help@luwag.test")).toBeVisible();
    expect(screen.getByText("+63 917 123 4567")).toBeVisible();
    expect(screen.getByText("Mon-Sat")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "settings_footer_handoff_link" }),
    ).toHaveAttribute("href", "/admin/storefront-shell?tab=footer");
  });

  it("never validates or sends the read-only support fields", async () => {
    const user = userEvent.setup();
    render(<SiteSettingsPage />);

    await screen.findByLabelText(/启用页脚上方订阅通栏/);
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(apiMock.updateSettings).toHaveBeenCalledTimes(1));
    const payload = apiMock.updateSettings.mock.calls[0][0];
    expect(Object.keys(payload)).not.toContain("supportEmail");
    expect(Object.keys(payload)).not.toContain("supportPhone");
    expect(Object.keys(payload)).not.toContain("supportHours");
    expect(screen.queryByText(/7–20/)).toBeNull();
  });
});
