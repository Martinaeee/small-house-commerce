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
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { listProductGroups: vi.fn(async () => ({ items: [{ product: { id: "p1", name: "Chair", productCode: "CHAIR-1", thumbnailUrl: null }, recordCount: 3, postCount: 2, lastPostDate: "2026-11-03", latestCreatedAt: "2026-11-03T01:00:00Z" }], total: 1, page: 1, pageSize: 20 })), archiveLink: vi.fn(), unarchiveLink: vi.fn(), createShortLink: vi.fn(async () => ({ path: "/s/abc", code: "abc", target: "/products/chair" })), listLinks: vi.fn(), linkContext: vi.fn(), createLink: vi.fn(), updateLink: vi.fn(), disableLink: vi.fn(), cloneLink: vi.fn(), ownerOptions: vi.fn(async () => []) } }));
const row: CampaignLinkRow = { postDate: null, postUrl: null, archivedAt: null, updatedAt: "2026-10-09T01:00:00Z", id: "link-1", code: "random-code", productId: "p1", productName: "Chair", productCode: "CHAIR-1", landingPageId: "page-1",
productThumbnailUrl: null, pageName: "My launch", variantId: null, variantNameSnapshot: null, name: "Ad A", sourceType: "META_AD", ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", status: "ACTIVE", version: 2, path: "/lp/chair-ad?cl=random-code", createdAt: "2026-10-09T01:00:00Z" };
const context: MarketingLinkContext = { products: [{ id: "p1", name: "Chair", productCode: "CHAIR-1", slug: "chair", thumbnailUrl: "/uploads/chair.jpg", variants: [{ id: "v1", name: "Red" }], landingPages: [{ id: "page-1", title: "My launch", slug: "chair-ad", ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", effectiveStatus: "SCHEDULED" }] }] };
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

describe("product post workspace", () => {
  it("defaults to grouped products and shares filters with the drawer", async () => {
    mount({ workspace: true });
    await screen.findAllByText("3 条记录");
    expect(marketingApi.listLinks).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "归档状态" }), { target: { value: "ALL" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "查看帖子" }))[0]!);
    await waitFor(() => expect(marketingApi.listLinks).toHaveBeenCalledWith(expect.objectContaining({ productId: "p1", archiveState: "ALL", orderBy: "POST_DATE_DESC" })));
  });
  it("explains a new own link hidden by a foreign owner filter", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_OWN"];
    vi.mocked(marketingApi.ownerOptions).mockResolvedValue([{ userId: "u2", aid: "OP-2", displayName: "Other", status: "ACTIVE", userStatus: "ACTIVE" }]);
    mount({ workspace: true }); await screen.findAllByText("3 条记录");
    await screen.findByRole("option", { name: /Other/ });
    fireEvent.change(screen.getByRole("combobox", { name: "投放师" }), { target: { value: "u2" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "新增帖子" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存并生成链接" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并生成链接" }));
    expect(await screen.findByText(/不符合当前投放师筛选/)).toBeInTheDocument();
  });
  it("defaults each view to its own archive state without clearing business filters", async () => {
    mount({ workspace: true }); await screen.findAllByText("3 条记录");
    fireEvent.change(screen.getByRole("combobox", { name: "商品" }), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "全部链接" }));
    await waitFor(() => expect(marketingApi.listLinks).toHaveBeenLastCalledWith(expect.objectContaining({ archiveState: "ALL", productId: "p1" })));
    expect(screen.getByRole("combobox", { name: "归档状态" })).toHaveValue("ALL");
    fireEvent.click(screen.getByRole("button", { name: "按商品" }));
    await waitFor(() => expect(marketingApi.listProductGroups).toHaveBeenLastCalledWith(expect.objectContaining({ archiveState: "UNARCHIVED", productId: "p1" })));
    expect(screen.getByRole("combobox", { name: "归档状态" })).toHaveValue("UNARCHIVED");
  });
  it("groups the flat view by source in Facebook, Meta and other order", async () => {
    vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [
      { ...row, id: "f1", name: "Post A", sourceType: "FB_POST", postDate: "2026-11-04" },
      { ...row, id: "m1", name: "Meta ad A", sourceType: "META_AD", postDate: null },
      { ...row, id: "o1", name: "Organic A", sourceType: "ORGANIC", postDate: null },
    ], total: 3, page: 1, pageSize: 100 });
    mount({ workspace: true }); await screen.findAllByText("3 条记录");
    fireEvent.click(screen.getByRole("button", { name: "全部链接" }));
    const facebook = await screen.findByRole("region", { name: /Facebook 发帖/ });
    const meta = screen.getByRole("region", { name: /Meta 广告/ });
    const other = screen.getByRole("region", { name: /其他来源/ });
    expect(within(facebook).getAllByRole("article")).toHaveLength(1);
    expect(within(meta).getAllByRole("article")).toHaveLength(1);
    expect(within(other).getAllByRole("article")).toHaveLength(1);
  });
  it("keeps the flat view and archives only against the saved version", async () => {
    mount({ workspace: true }); await screen.findAllByText("3 条记录");
    fireEvent.click(screen.getByRole("button", { name: "全部链接" }));
    await screen.findByText("Ad A");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "归档这条记录" }));
    await waitFor(() => expect(marketingApi.archiveLink).toHaveBeenCalledWith("link-1", 2));
  });
});

describe("campaign link filters and thumbnails", () => {
  it("filters by product and optimizer from dedicated selects", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_OWN"];
    vi.mocked(marketingApi.ownerOptions).mockResolvedValue([{ userId: "u2", aid: "OP-2", displayName: "Other", status: "ACTIVE", userStatus: "ACTIVE" }]);
    mount();
    await screen.findByText("Ad A");
    fireEvent.change(screen.getByRole("combobox", { name: "商品" }), { target: { value: "p1" } });
    await waitFor(() => expect(marketingApi.listLinks).toHaveBeenLastCalledWith(expect.objectContaining({ productId: "p1", page: 1 })));
    fireEvent.change(screen.getByRole("combobox", { name: "投放师" }), { target: { value: "u2" } });
    await waitFor(() => expect(marketingApi.listLinks).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: "u2", page: 1 })));
  });

  it("hides the optimizer filter for own-scope users", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"];
    mount();
    await screen.findByText("Ad A");
    expect(screen.queryByRole("combobox", { name: "投放师" })).not.toBeInTheDocument();
  });

  it("renders the product thumbnail before the product name", async () => {
    vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [{ ...row, productThumbnailUrl: "/uploads/chair.jpg" }], total: 1, page: 1, pageSize: 20 });
    mount();
    await screen.findByText("Ad A");
    expect(screen.getByRole("img", { name: /Chair/ })).toHaveAttribute("src", "/uploads/chair.jpg");
  });

  it("keeps a labelled placeholder when the product has no image", async () => {
    mount();
    await screen.findByText("Ad A");
    expect(screen.getByRole("img", { name: "商品暂无图片" })).toBeInTheDocument();
  });
});

describe("persisted campaign links", () => {
  it("creates a page link with parent and page preselected but never asks for or sends an owner or AID", async () => {
    mount({ productId: "p1", landingPageId: "page-1" });
    await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "创建投放链接" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("落地页（可选）")).toHaveValue("page-1"));
    await waitFor(() => expect(within(dialog).getByTestId("link-builder-product-current")).toHaveTextContent("Chair"));
    expect(within(dialog).getByTestId("link-builder-product-thumb")).toHaveAttribute("src", "/uploads/chair.jpg");
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
    expect(marketingApi.updateLink).toHaveBeenCalledWith("link-1", { name: "Unsaved name", expectedVersion: 2 });
    expect(within(dialog).queryByLabelText("商品")).not.toBeInTheDocument();
  });

  it("opens expenses with the immutable link, product and page context", async () => {
    mount(); await screen.findByText("Ad A");
    expect(screen.getByRole("link", { name: "广告费用" })).toHaveAttribute("href", "/admin/marketing/costs?productId=p1&landingPageId=page-1&linkId=link-1");
    expect(screen.getByRole("link", { name: "核算" })).toHaveAttribute("href", "/admin/marketing/reports?productId=p1&landingPageId=page-1&linkId=link-1");
  });

  it("confirms a successful copy in a dialog with the full URL", async () => {
    mount(); await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "复制网址" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(new URL(row.path, window.location.origin).href));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("复制成功")).toBeInTheDocument();
    expect(within(dialog).getByText("已复制")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("投放网址")).toHaveValue(new URL(row.path, window.location.origin).href);
  });

  it("prefills a new-link copy and sends the edited ad parameters without changing ownership", async () => {
    mount(); await screen.findByText("Ad A"); fireEvent.click(screen.getByRole("button", { name: "复制记录" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByTestId("link-builder-product-current")).toHaveTextContent("Chair"));
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
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("复制失败")).toBeInTheDocument();
    expect(within(dialog).getByText("复制失败，请手动选择并复制")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("投放网址")).toHaveValue(new URL(row.path, window.location.origin).href);
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
