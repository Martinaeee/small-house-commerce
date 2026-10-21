import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignLinksList } from "@/components/admin/marketing/CampaignLinksList";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { marketingApi, type CampaignLinkRow, type MarketingLinkContext } from "@/lib/marketing-api";
import { copyText } from "@/lib/clipboard";
const auth = vi.hoisted(() => ({ admin: { id: "u1", name: "Operator", permissions: ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"] }, status: "authed" }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({ useAdminAuth: () => auth }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { listLinks: vi.fn(), linkContext: vi.fn(), createLink: vi.fn(), updateLink: vi.fn(), disableLink: vi.fn(), cloneLink: vi.fn() } }));
const row: CampaignLinkRow = { updatedAt: "2026-10-09T01:00:00Z", id: "link-1", code: "random-code", productId: "p1", productName: "Chair", productCode: "CHAIR-1", landingPageId: "page-1", pageName: "My launch", variantId: null, variantNameSnapshot: null, name: "Ad A", sourceType: "META_AD", ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", status: "ACTIVE", version: 2, path: "/lp/chair-ad?cl=random-code", createdAt: "2026-10-09T01:00:00Z" };
const context: MarketingLinkContext = { products: [{ id: "p1", name: "Chair", productCode: "CHAIR-1", slug: "chair", variants: [{ id: "v1", name: "Red" }], landingPages: [{ id: "page-1", title: "My launch", slug: "chair-ad", ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", effectiveStatus: "SCHEDULED" }] }] };
const mount = (props = {}) => render(<AdminI18nProvider><CampaignLinksList {...props} /></AdminI18nProvider>);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); auth.admin.permissions = ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"];
  vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 20 });
  vi.mocked(marketingApi.linkContext).mockResolvedValue(context);
  vi.mocked(marketingApi.createLink).mockResolvedValue({ ...row, id: "link-2", code: "new-code" });
  vi.mocked(marketingApi.cloneLink).mockResolvedValue({ ...row, id: "link-2", code: "new-code" });
  vi.mocked(marketingApi.disableLink).mockResolvedValue({ ...row, status: "DISABLED", version: 3 });
  vi.mocked(copyText).mockResolvedValue(true);
});

describe("persisted campaign links", () => {
  it("creates a page link with parent and page preselected but never asks for or sends an owner or AID", async () => {
    mount({ productId: "p1", landingPageId: "page-1" });
    await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "创建投放链接" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("落地页（可选）")).toHaveValue("page-1"));
    expect(within(dialog).getByLabelText("商品")).toHaveValue("p1");
    expect(within(dialog).getByText(/OP-1/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /AID/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/开始时间前不可访问/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("内部名称"), { target: { value: "Launch ad" } });
    fireEvent.change(within(dialog).getByLabelText("Ad ID"), { target: { value: "ad-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并生成链接" }));
    await waitFor(() => expect(marketingApi.createLink).toHaveBeenCalledOnce());
    const input = vi.mocked(marketingApi.createLink).mock.calls[0][0];
    expect(input).toMatchObject({ productId: "p1", landingPageId: "page-1", name: "Launch ad", adId: "ad-123" });
    expect(input).not.toHaveProperty("ownerUserId"); expect(input).not.toHaveProperty("aid");
  });

  it("does not silently retarget a draft or inactive preselected page to the product page", async () => {
    vi.mocked(marketingApi.linkContext).mockResolvedValue({ products: [{ ...context.products[0], landingPages: [] }] });
    mount({ productId: "p1", landingPageId: "page-1" }); await screen.findByText("Ad A");
    fireEvent.click(screen.getByRole("button", { name: "创建投放链接" }));
    expect(await screen.findByText(/所选页面尚未发布或不可投放/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存并生成链接" })).toBeDisabled();
  });

  it("retains rename input on conflict and only permits name editing", async () => {
    vi.mocked(marketingApi.updateLink).mockRejectedValue(new AdminApiError("Conflict", 409));
    mount(); await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "改名" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("内部名称"), { target: { value: "Unsaved name" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(await within(dialog).findByText(/版本冲突/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("内部名称")).toHaveValue("Unsaved name");
    expect(marketingApi.updateLink).toHaveBeenCalledWith("link-1", "Unsaved name", 2);
    expect(within(dialog).queryByLabelText("商品")).not.toBeInTheDocument();
  });

  it("opens expenses with the immutable link, product and page context", async () => {
    mount(); await screen.findByText("Ad A");
    expect(screen.getByRole("link", { name: "广告费用" })).toHaveAttribute("href", "/admin/marketing/costs?productId=p1&landingPageId=page-1&linkId=link-1");
    expect(screen.getByRole("link", { name: "核算" })).toHaveAttribute("href", "/admin/marketing/reports?productId=p1&landingPageId=page-1&linkId=link-1");
  });

  it("copies only the stored public URL", async () => {
    mount(); await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "复制网址" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(new URL(row.path, window.location.origin).href));
  });

  it("prefills a new-link copy and sends the edited ad parameters without changing ownership", async () => {
    mount(); await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "复制记录" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("商品")).toHaveValue("p1"));
    expect(within(dialog).getByLabelText("内部名称")).toHaveValue("Ad A copy");
    expect(within(dialog).getByText(/OP-1/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Ad ID"), { target: { value: "another-ad" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并生成链接" }));
    await waitFor(() => expect(marketingApi.cloneLink).toHaveBeenCalledWith("link-1", expect.objectContaining({ productId: "p1", landingPageId: "page-1", adId: "another-ad", name: "Ad A copy" })));
    expect(marketingApi.createLink).not.toHaveBeenCalled();
    expect(vi.mocked(marketingApi.cloneLink).mock.calls[0][1]).not.toHaveProperty("ownerUserId");
  });

  it("retains a selectable saved URL when the clipboard is unavailable", async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    mount(); await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "复制网址" }));
    expect(await screen.findByText("复制失败，请手动选择并复制")).toBeInTheDocument();
    expect(screen.getByLabelText("投放网址 · Ad A")).toHaveValue(new URL(row.path, window.location.origin).href);
  });

  it("keeps finance read-only and disables an owned link against its saved version", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL"];
    const view = mount(); await screen.findByText("Ad A");
    for (const name of ["创建投放链接", "改名", "复制记录", "停用"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    view.unmount(); auth.admin.permissions = ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount(); await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await waitFor(() => expect(marketingApi.disableLink).toHaveBeenCalledWith("link-1", 2));
  });
});
