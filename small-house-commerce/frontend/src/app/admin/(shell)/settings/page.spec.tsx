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
  newsletterEyebrow: "The LUWAG edit",
  newsletterFormTitle: "Subscribe by email",
  newsletterEmailPlaceholder: "Your email address",
  newsletterConsentText:
    "By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.",
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
  it("loads and saves the site-wide selling-point visibility switch", async () => {
    apiMock.getSettings.mockResolvedValue({ ...settings, hideSellingPoints: true });
    apiMock.updateSettings.mockResolvedValue({ ...settings, hideSellingPoints: false });
    const user = userEvent.setup();
    render(<SiteSettingsPage />);
    const toggle = await screen.findByRole("checkbox", { name: "settings_hide_selling_points" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(apiMock.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ hideSellingPoints: false }),
    ));
    expect(toggle).not.toBeChecked();
  });
  it("loads and saves all newsletter display settings", async () => {
    const user = userEvent.setup();
    render(<SiteSettingsPage />);

    const band = await screen.findByLabelText(/启用页脚上方订阅通栏/);
    const popup = screen.getByLabelText(/启用首访优惠弹窗/);
    expect(band).toBeChecked();
    expect(popup).not.toBeChecked();
    expect(screen.getByLabelText(/弹窗延迟（秒）/)).toHaveValue(5);
    expect(screen.getByLabelText(/优惠标题/)).toHaveValue("Subscribe and save");
    expect(screen.getByLabelText(/优惠正文/)).toHaveValue("Welcome to LUWAG.");
    expect(screen.getByLabelText(/订阅区小标签/)).toHaveValue("The LUWAG edit");
    expect(screen.getByLabelText(/表单标题/)).toHaveValue("Subscribe by email");
    expect(screen.getByLabelText(/邮箱占位文案/)).toHaveValue("Your email address");
    expect(screen.getByLabelText(/同意与退订说明/)).toHaveValue(
      "By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.",
    );
    await user.click(popup);
    await user.clear(screen.getByLabelText(/弹窗延迟（秒）/));
    await user.type(screen.getByLabelText(/弹窗延迟（秒）/), "8");
    await user.clear(screen.getByLabelText(/优惠标题/));
    await user.type(screen.getByLabelText(/优惠标题/), "Join and save");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(apiMock.updateSettings).toHaveBeenCalledWith({
        messengerUrl: "https://m.me/luwag",
        supportPhone: "+63 917 123 4567",
        hideSellingPoints: false,
        newsletterBandEnabled: true,
        newsletterPopupEnabled: true,
        newsletterPopupDelaySeconds: 8,
        newsletterOfferTitle: "Join and save",
        newsletterOfferBody: "Welcome to LUWAG.",
        newsletterEyebrow: "The LUWAG edit",
        newsletterFormTitle: "Subscribe by email",
        newsletterEmailPlaceholder: "Your email address",
        newsletterConsentText:
          "By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.",
      }),
    );
  });

  it("keeps email and hours read-only while the support phone is edited and saved here", async () => {
    const user = userEvent.setup();
    render(<SiteSettingsPage />);

    expect(await screen.findByText("help@luwag.test")).toBeVisible();
    expect(screen.getByText("Mon-Sat")).toBeVisible();

    const phone = screen.getByLabelText(/客服电话/);
    expect(phone).toHaveValue("+63 917 123 4567");
    await user.clear(phone);
    await user.type(phone, "0935 977 7504");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(apiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ supportPhone: "0935 977 7504" }),
      );
    });

    expect(
      screen.getByRole("link", { name: "settings_footer_handoff_link" }),
    ).toHaveAttribute("href", "/admin/storefront-shell?tab=footer");
  });

  it("rejects blank required newsletter copy before calling the API", async () => {
    const user = userEvent.setup();
    render(<SiteSettingsPage />);

    const eyebrow = await screen.findByLabelText(/订阅区小标签/);
    await user.clear(eyebrow);
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    expect(
      screen.getByText("订阅区小标签需为 1–80 个字符。"),
    ).toBeInTheDocument();
    expect(apiMock.updateSettings).not.toHaveBeenCalled();
  });
});
