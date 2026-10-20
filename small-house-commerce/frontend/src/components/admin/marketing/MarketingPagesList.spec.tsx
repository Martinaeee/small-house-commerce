import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketingPagesList } from "@/components/admin/marketing/MarketingPagesList";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { marketingApi, type MarketingPageDetail, type MarketingPageListRow } from "@/lib/marketing-api";
import type { LandingContent } from "@/lib/marketing-content";
import { AdminApiError } from "@/lib/admin-auth";
const auth = vi.hoisted(() => ({ admin: { id: "u1", name: "Operator", permissions: ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"] }, status: "authed" }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({ useAdminAuth: () => auth }));
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { listPages: vi.fn(), ownerOptions: vi.fn(), productOptions: vi.fn(), createPage: vi.fn(), disable: vi.fn(), assignOwner: vi.fn(), getPage: vi.fn() } }));
const content: LandingContent = { schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null, blocks: [{ id: "buy", type: "buy", sourceKey: null, props: {} }] };
const row: MarketingPageDetail & MarketingPageListRow = { status: "ACTIVE", publishedAt: "2026-10-09T01:00:00Z", startAt: null, endAt: null, draftContent: content, publishedContent: content, sourceContentHash: "source", id: "page-1", productId: "p1", productName: "Chair", productCode: "CHAIR-1", productSlug: "chair", productStatus: "ACTIVE", ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", name: "My launch", slug: "chair-ad", effectiveStatus: "LIVE", hasUnpublishedChanges: true, linkCount: 2, periodViews: 3, periodOrders: 1, publishedRevision: 1, version: 2, updatedAt: "2026-10-09T01:00:00Z" };
const mount = (props = {}) => render(<AdminI18nProvider><MarketingPagesList {...props} /></AdminI18nProvider>);
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); auth.admin.permissions = ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"]; vi.mocked(marketingApi.listPages).mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 20 }); vi.mocked(marketingApi.ownerOptions).mockResolvedValue([{ userId: "u1", aid: "OP-1", displayName: "Optimizer", status: "ACTIVE", userStatus: "ACTIVE" }]); vi.mocked(marketingApi.productOptions).mockResolvedValue({ items: [{ id: "p1", name: "Chair", productCode: "CHAIR-1", slug: "chair", status: "ACTIVE", thumbnailUrl: "/uploads/chair.jpg" }], total: 1, page: 1, pageSize: 50 }); vi.mocked(marketingApi.createPage).mockResolvedValue({ ...row, id: "new-page", effectiveStatus: "DRAFT" }); });

describe("marketing page workbench", () => {
  it("shows bounded period counts rather than lifetime values", async () => {
    vi.mocked(marketingApi.listPages).mockResolvedValue({ items: [{ ...row, periodViews: 3, periodOrders: 2 }], total: 1, page: 1, pageSize: 20 });
    mount(); await screen.findByText(row.name);
    expect(screen.queryByText(/统计将在真实触达链路接通后提供/)).not.toBeInTheDocument();
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader").map(element => element.textContent);
    const cells = within(screen.getByRole("row", { name: new RegExp(row.name) })).getAllByRole("cell");
    expect(headers).toContain("期间访问"); expect(headers).toContain("期间有效订单");
    expect(cells[headers.indexOf("期间访问")]).toHaveTextContent(/^3$/);
    expect(cells[headers.indexOf("期间有效订单")]).toHaveTextContent(/^2$/);
  });

  it("supplies default period dates and keeps modification filtering separate", async () => {
    mount(); await screen.findByText(row.name);
    expect(screen.getByLabelText("统计日期从（马尼拉）")).not.toHaveValue("");
    expect(screen.getByLabelText("统计日期至（马尼拉）")).not.toHaveValue("");
    fireEvent.change(screen.getByLabelText("统计日期从（马尼拉）"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("统计日期至（马尼拉）"), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText("修改日期从（马尼拉）"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(marketingApi.listPages).toHaveBeenLastCalledWith(expect.objectContaining({ periodFrom: "2026-10-01", periodTo: "2026-10-03", dateFrom: "2026-09-01" })));
  });

  it("hides all-owner rows immediately when the same account loses broad viewing", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL"];
    vi.mocked(marketingApi.listPages).mockResolvedValueOnce({ items: [{ ...row, ownerUserId: "foreign-owner", name: "Foreign private page" }], total: 1, page: 1, pageSize: 20 }).mockImplementationOnce(() => new Promise(() => {}));
    const view = mount(); await screen.findByText("Foreign private page");
    auth.admin.permissions = ["MARKETING_VIEW_OWN"];
    view.rerender(<AdminI18nProvider><MarketingPagesList /></AdminI18nProvider>);
    expect(screen.queryByText("Foreign private page")).not.toBeInTheDocument();
    await waitFor(() => expect(marketingApi.listPages).toHaveBeenCalledTimes(2));
  });

  it("keeps product context and joins editing, performance and saved preview without lifetime metrics masquerading as period metrics", async () => {
    mount({ productId: "p1" }); await screen.findByText("My launch");
    expect(screen.getByText("有未发布修改")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "编辑页面" })).toHaveAttribute("href", "/admin/marketing/page-1/edit");
    expect(screen.getByRole("link", { name: "查看效果" })).toHaveAttribute("href", "/admin/marketing/compare?productId=p1");
    expect(screen.getByRole("link", { name: "已保存草稿预览" })).toHaveAttribute("href", "/admin/marketing/page-1/preview");
    expect(screen.getByRole("link", { name: "创建投放链接" })).toHaveAttribute("href", "/admin/marketing/links?productId=p1&landingPageId=page-1");
    expect(screen.getByRole("link", { name: "广告费用" })).toHaveAttribute("href", "/admin/marketing/costs?productId=p1&landingPageId=page-1");
    expect(screen.getByRole("link", { name: "核算" })).toHaveAttribute("href", "/admin/marketing/reports?productId=p1&landingPageId=page-1");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("转化率")).not.toBeInTheDocument();
  });
  it("filters administrators by explicit owner and distinguishes modification dates from accounting dates", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_ALL"];
    mount(); await screen.findByText("My launch");
    fireEvent.change(screen.getByLabelText("负责人"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("修改日期从（马尼拉）"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(marketingApi.listPages).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: "u1", dateFrom: "2026-10-01" })));
    expect(screen.getByText(/不是核算的触达日期/)).toBeInTheDocument();
  });
  it("creates a saved-product draft and enters the full editor, without publishing", async () => {
    mount({ productId: "p1" }); await screen.findByText("My launch");
    fireEvent.click(screen.getByRole("button", { name: "创建页面" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByTestId("marketing-page-product-current")).toHaveTextContent("Chair"));
    expect(within(dialog).getByTestId("marketing-page-product-thumb")).toHaveAttribute("src", "/uploads/chair.jpg");
    fireEvent.change(within(dialog).getByLabelText("内部名称"), { target: { value: "My independent page" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建草稿并编辑" }));
    await waitFor(() => expect(marketingApi.createPage).toHaveBeenCalledWith("p1", "My independent page", undefined));
    expect(router.push).toHaveBeenCalledWith("/admin/marketing/new-page/edit");
  });
  it("keeps the parent picker usable and shows each candidate product's photo", async () => {
    mount(); await screen.findByText("My launch");
    fireEvent.click(screen.getByRole("button", { name: "创建页面" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByTestId("marketing-page-product-open"));
    const option = await within(dialog).findByTestId("marketing-page-product-grid-option-chair");
    expect(option).toHaveTextContent("Chair");
    await userEvent.click(option);
    expect(within(dialog).getByTestId("marketing-page-product-current")).toHaveTextContent("Chair");
  });

  it("assigns a legacy page using its real version, preserves a conflicted choice and reloads only explicitly", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_ALL"];
    const unassigned = { ...row, ownerUserId: null, ownerName: null, aid: null };
    vi.mocked(marketingApi.listPages).mockResolvedValue({ items: [unassigned], total: 1, page: 1, pageSize: 20 });
    vi.mocked(marketingApi.ownerOptions).mockResolvedValue([{ userId: "u1", aid: "OP-1", displayName: "Optimizer", status: "ACTIVE", userStatus: "ACTIVE" }, { userId: "u2", aid: "OP-2", displayName: "Disabled optimizer", status: "DISABLED", userStatus: "ACTIVE" }]);
    vi.mocked(marketingApi.assignOwner).mockRejectedValueOnce(new AdminApiError("Conflict", 409)).mockResolvedValueOnce(row);
    vi.mocked(marketingApi.getPage).mockResolvedValue({ ...unassigned, version: 3 });
    mount(); await screen.findByText("My launch");
    fireEvent.click(screen.getByRole("button", { name: "分配负责人" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Optimizer · OP-1" });
    expect(within(dialog).queryByRole("option", { name: /Disabled optimizer/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/历史订单、链接与费用归属不会改变/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("负责人"), { target: { value: "u1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认分配" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByLabelText("负责人")).toHaveValue("u1");
    expect(marketingApi.assignOwner).toHaveBeenCalledExactlyOnceWith("page-1", "u1", 2);
    expect(marketingApi.getPage).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "重新载入已保存版本" }));
    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "确认分配" }));
    await waitFor(() => expect(marketingApi.assignOwner).toHaveBeenLastCalledWith("page-1", "u1", 3));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([["MARKETING_VIEW_ALL"], ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_OWN"]])("never exposes assignment to a broad reader without all-owner management (%s)", async (...permissions) => {
    auth.admin.permissions = permissions;
    vi.mocked(marketingApi.listPages).mockResolvedValue({ items: [{ ...row, ownerUserId: null, ownerName: null, aid: null }], total: 1, page: 1, pageSize: 20 });
    mount(); await screen.findByText("My launch");
    expect(screen.queryByRole("button", { name: "分配负责人" })).not.toBeInTheDocument();
    expect(marketingApi.assignOwner).not.toHaveBeenCalled();
  });

  it("allows finance to inspect pages without editing or creating resources", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL"];
    mount(); await screen.findByText("My launch");
    expect(screen.queryByRole("button", { name: "创建页面" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "创建投放链接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看页面" })).toHaveAttribute("href", "/admin/marketing/page-1/edit");
  });
});
