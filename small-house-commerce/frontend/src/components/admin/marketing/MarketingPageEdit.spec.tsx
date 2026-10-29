import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketingPageEdit from "@/components/admin/marketing/MarketingPageEdit";
import { AdminI18nProvider, setAdminLang, useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { marketingApi, type MarketingPageDetail, type MarketingPerformanceReport } from "@/lib/marketing-api";
import type { LandingContent } from "@/lib/marketing-content";
import type { Product } from "@/lib/api";

const auth = vi.hoisted(() => ({ admin: { id: "u1", name: "Operator", permissions: ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"] }, status: "authed" }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({ useAdminAuth: () => auth }));
const uploadBoundary = vi.hoisted(() => ({ notify: undefined as undefined | ((pending: boolean) => void) }));
vi.mock("next/dynamic", () => ({ default: () => (props: { content: LandingContent; validatedPreview: LandingContent | null; onChange: (content: LandingContent) => void; onUploadingChange?: (pending: boolean) => void }) => {
  uploadBoundary.notify = props.onUploadingChange;
  const edit = (html: string) => props.onChange({ ...props.content, blocks: props.content.blocks.map((block) => block.type === "richText" ? { ...block, props: { html } } : block) });
  return <div aria-label="Editor canvas boundary">
    <p data-testid="editor-document">{JSON.stringify(props.content)}</p>
    <p data-testid="validated-preview">{JSON.stringify(props.validatedPreview)}</p>
    <button onClick={() => edit('<p onclick="bad()">First draft</p><script>bad()</script>')}>Edit body</button>
    <button onClick={() => props.onUploadingChange?.(true)}>Start media upload</button>
    <button onClick={() => props.onUploadingChange?.(false)}>Finish media upload</button>
    <button onClick={() => edit("<p>Second draft</p>")}>Edit again</button>
  </div>;
} }));
vi.mock("@/lib/marketing-api", async (load) => ({ ...await load(), marketingApi: { getPage: vi.fn(), getPreview: vi.fn(), saveDraft: vi.fn(), publish: vi.fn(), disable: vi.fn(), listLinks: vi.fn(), listCosts: vi.fn(), report: vi.fn(), ownerOptions: vi.fn(), linkContext: vi.fn(async () => ({ products: [] })), validate: vi.fn(), source: vi.fn(), sync: vi.fn(), performance: vi.fn(), performanceOptions: vi.fn() } }));
vi.mock("./PerformanceTrendChart", () => ({ default: () => null }));
const content: LandingContent = { schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null, blocks: [{ id: "buy", type: "buy", sourceKey: null, props: {} }, { id: "body", type: "richText", sourceKey: null, props: { html: "<p>Saved body</p>" } }] };
const cleaned = (html: string): LandingContent => ({ ...content, blocks: [content.blocks[0], { id: "body", type: "richText", sourceKey: null, props: { html } }] });
const row: MarketingPageDetail = {
  id: "page-1", productId: "product-1", productName: "Chair", productCode: "LUW-001", productSlug: "chair", productStatus: "ACTIVE",
  ownerUserId: "u1", ownerName: "Operator", aid: "OP-1", name: "MA-1", slug: "ma-1", status: "ACTIVE", effectiveStatus: "LIVE", hasUnpublishedChanges: false,
  version: 2, publishedRevision: 1, publishedAt: "2026-10-09T01:00:00Z", startAt: null, endAt: null, updatedAt: "2026-10-09T01:00:00Z",
  draftContent: content, publishedContent: content, sourceContentHash: "source",
};
const product: Product = { id: "product-1", name: "Chair", slug: "chair", description: null, tagline: null, categoryId: "category-1", ratingAverage: null, reviewCount: 0, room: null, internalRole: null, solutions: [], width: null, height: null, depth: null, foldedWidth: null, foldedHeight: null, foldedDepth: null, catalogGraphVersion: 0, options: [], defaultDisplayVariantId: null, effectiveCoverMedia: null, images: [], variants: [] };
const perfReport: MarketingPerformanceReport = {
  asOf: "2026-10-13T01:00:00.000Z",
  scope: { view: "PRODUCT", productId: "product-1", ownerUserId: null, landingPageId: "page-1", effectiveStatus: null, onlyOwn: false },
  overview: { total: 0, byStatus: { DRAFT: 0, LIVE: 0, SCHEDULED: 0, ENDED: 0, DISABLED: 0 }, byProduct: [] },
  current: { range: { from: "2026-10-06", to: "2026-10-12" }, registeredLinkCount: 0, totals: null },
  previous: null, changes: null, page: 1, pageSize: 20, total: 0, rows: [],
  trend: { pageId: null, interval: "DAY", points: [] },
  otherSources: { current: [], previous: null },
};
function LanguageSwitch() {
  const { setLang } = useAdminI18n();
  return <button onClick={() => setLang("en")}>Switch language</button>;
}
const tree = (pageId = "page-1") => <AdminI18nProvider><LanguageSwitch /><MarketingPageEdit pageId={pageId} /></AdminI18nProvider>;
const mount = () => render(tree());
const clickStep = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
async function settings() { await screen.findByText("LUW-001"); fireEvent.click(screen.getByRole("button", { name: "更多设置" })); }

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); setAdminLang("zh"); auth.admin.id = "u1";
  auth.admin.permissions = ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"];
  vi.mocked(marketingApi.getPage).mockResolvedValue(structuredClone(row));
  vi.mocked(marketingApi.getPreview).mockResolvedValue({ content, product, version: 2 });
  vi.mocked(marketingApi.saveDraft).mockResolvedValue({ ...row, version: 3, hasUnpublishedChanges: true });
  vi.mocked(marketingApi.publish).mockResolvedValue({ ...row, version: 3, publishedRevision: 2 });
  vi.mocked(marketingApi.validate).mockImplementation(async (_id, document) => document);
  vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  vi.mocked(marketingApi.listCosts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  vi.mocked(marketingApi.ownerOptions).mockResolvedValue([]);
  vi.mocked(marketingApi.report).mockResolvedValue({ from: "2026-10-01", to: "2026-10-03", groupBy: "LINK", mode: "FLAT", sortBy: "NAME", sortDirection: "ASC", asOf: "2026-10-11T01:00:00Z", rows: [], otherSources: [], total: 0, page: 1, pageSize: 20 });
  vi.mocked(marketingApi.performanceOptions).mockResolvedValue({ onlyOwn: false, products: [{ id: "product-1", name: "Chair", productCode: "LUW-001", status: "ACTIVE", thumbnailUrl: "/uploads/chair.jpg", pageCount: 1 }], owners: [] });
  vi.mocked(marketingApi.performance).mockResolvedValue(perfReport);
});

describe("marketing page editing", () => {
  it("keeps page-list and current-product comparison navigation visible in the editor header", async () => {
    mount();
    await screen.findByText("LUW-001");
    expect(screen.getByRole("link", { name: "返回页面列表" })).toHaveAttribute("href", "/admin/marketing");
    expect(screen.getByRole("link", { name: "返回商品比较" })).toHaveAttribute("href", "/admin/marketing/compare?productId=product-1");
  });

  it("moves through the four steps without saving, publishing, reloading or discarding local edits", async () => {
    const confirm = vi.spyOn(window, "confirm");
    mount(); await screen.findByText("LUW-001");
    fireEvent.change(screen.getByLabelText("内部名称"), { target: { value: "Space-saving chair campaign" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit again" }));
    clickStep("2 预览发布");
    expect(screen.getByText("本地有未保存修改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新线上版本" })).toBeDisabled();
    clickStep("3 投放链接");
    await screen.findByText("暂无符合条件的投放链接。");
    clickStep("1 编辑内容");
    expect(screen.getByLabelText("内部名称")).toHaveValue("Space-saving chair campaign");
    expect(screen.getByTestId("editor-document")).toHaveTextContent("Second draft");
    expect(marketingApi.saveDraft).not.toHaveBeenCalled();
    expect(marketingApi.publish).not.toHaveBeenCalled();
    expect(marketingApi.getPage).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "4 费用与效果" })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("disables the saved page without discarding unsaved name or content and saves against the returned version", async () => {
    vi.mocked(marketingApi.disable).mockResolvedValue({ ...row, status: "DISABLED", effectiveStatus: "DISABLED", version: 3 });
    mount(); await settings();
    fireEvent.change(screen.getByLabelText("内部名称"), { target: { value: "My unfinished campaign" } });
    fireEvent.change(screen.getByLabelText("SEO 标题"), { target: { value: "Unsaved SEO" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit again" }));
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "停用" })).toBeDisabled());
    expect(screen.getByTestId("editor-document")).toHaveTextContent("Second draft");
    expect(screen.getByLabelText("内部名称")).toHaveValue("My unfinished campaign");
    expect(screen.getByLabelText("SEO 标题")).toHaveValue("Unsaved SEO");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(marketingApi.saveDraft).toHaveBeenCalledWith("page-1", expect.objectContaining({ seoTitle: "Unsaved SEO", blocks: expect.arrayContaining([expect.objectContaining({ props: { html: "<p>Second draft</p>" } })]) }), 3, "My unfinished campaign"));
    expect(marketingApi.publish).not.toHaveBeenCalled();
  });

  it("locks draft save, publication, sync and step switching until media uploads settle", async () => {
    mount(); await screen.findByText("LUW-001");
    fireEvent.click(screen.getByRole("button", { name: "Start media upload" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "更新线上版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "同步母商品" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2 预览发布" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3 投放链接" })).toBeDisabled();
    expect(screen.getByText("上传中，请完成后切换。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2 预览发布" }));
    expect(screen.getByLabelText("内部名称")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(marketingApi.saveDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish media upload" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2 预览发布" })).toBeEnabled();
  });

  it("does not let the old account upload completion release the new account lock", async () => {
    const view = mount(); await screen.findByText("LUW-001");
    const oldNotify = uploadBoundary.notify;
    auth.admin.id = "u2";
    vi.mocked(marketingApi.getPage).mockResolvedValue({ ...row, ownerUserId: "u2", productCode: "LUW-002" });
    view.rerender(tree()); await screen.findByText("LUW-002");
    fireEvent.click(screen.getByRole("button", { name: "Start media upload" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await act(async () => oldNotify?.(false));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Finish media upload" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });

  it("preserves entered names on a server version conflict without retrying or reloading", async () => {
    vi.mocked(marketingApi.saveDraft).mockRejectedValue(new AdminApiError("Conflict", 409));
    mount(); await settings();
    fireEvent.change(screen.getByLabelText("内部名称"), { target: { value: "My unsaved campaign" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByText(/版本冲突/)).toBeInTheDocument();
    expect(screen.getByLabelText("内部名称")).toHaveValue("My unsaved campaign");
    expect(marketingApi.getPage).toHaveBeenCalledTimes(1);
    expect(marketingApi.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("saves names and Manila wall-clock dates as draft content without publishing", async () => {
    mount(); await settings();
    fireEvent.change(screen.getByLabelText("内部名称"), { target: { value: "Scheduled campaign" } });
    fireEvent.change(screen.getByLabelText("开始时间（马尼拉）"), { target: { value: "2026-10-15T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(marketingApi.saveDraft).toHaveBeenCalledWith("page-1", expect.objectContaining({ startAt: "2026-10-15T09:00:00+08:00" }), 2, "Scheduled campaign"));
    expect(marketingApi.publish).not.toHaveBeenCalled();
    expect(await screen.findByText("线上版本仍在使用；有待发布更改。")).toBeInTheDocument();
    expect(screen.queryByText("有未发布修改")).not.toBeInTheDocument();
  });

  it("blocks publication of local edits until the draft is saved", async () => {
    mount(); await settings();
    fireEvent.change(screen.getByLabelText("内部名称"), { target: { value: "Changed" } });
    expect(screen.getByRole("button", { name: "更新线上版本" })).toBeDisabled();
    expect(screen.getByText("请先保存，再发布或同步母商品。" )).toBeInTheDocument();
  });

  it("keeps the saved draft preview and the public version separate from local input", async () => {
    mount(); await screen.findByText("LUW-001");
    expect(screen.getByText("当前为内部编辑预览，不计访问、不下单；顾客看到的是已发布版本。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("内部名称"), { target: { value: "Local only" } });
    clickStep("2 预览发布");
    expect(screen.getByText("本地有未保存修改")).toBeInTheDocument();
    expect(screen.getByText(/不包含本地未保存输入/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "已保存草稿预览" })).toHaveAttribute("href", "/admin/marketing/page-1/preview");
    expect(screen.getByRole("link", { name: "查看线上版本" })).toHaveAttribute("href", "/lp/ma-1");
    expect(marketingApi.saveDraft).not.toHaveBeenCalled();
  });

  it("lets finance browse every step read-only without save, publish or create controls", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL"];
    mount(); await settings();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新线上版本" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("内部名称")).toBeDisabled();
    clickStep("3 投放链接");
    await screen.findByText("暂无符合条件的投放链接。");
    expect(screen.queryByRole("button", { name: "创建投放链接" })).not.toBeInTheDocument();
    clickStep("4 费用与效果");
    await waitFor(() => expect(marketingApi.listCosts).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "录入费用" })).not.toBeInTheDocument();
  });

  it("syncs only selected source keys against the saved version without publishing", async () => {
    const fresh: LandingContent = { ...content, blocks: [{ id: "hero", type: "hero", sourceKey: "hero:p1", props: { title: "Saved parent", tagline: null, promoHeadline: null, promoSubtext: null } }, content.blocks[0]] };
    vi.mocked(marketingApi.source).mockResolvedValue({ content: fresh, changed: true, sourceContentHash: "latest" });
    vi.mocked(marketingApi.sync).mockResolvedValue({ ...row, version: 3, draftContent: fresh, hasUnpublishedChanges: true });
    mount(); await screen.findByText("LUW-001");
    fireEvent.click(screen.getByRole("button", { name: "同步母商品" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Saved parent/ }));
    fireEvent.change(screen.getByLabelText("恢复模块的位置"), { target: { value: "buy" } });
    fireEvent.click(screen.getByRole("button", { name: "同步所选模块" }));
    await waitFor(() => expect(marketingApi.sync).toHaveBeenCalledWith("page-1", ["hero:p1"], 2, "buy"));
    expect(marketingApi.publish).not.toHaveBeenCalled();
    expect(await screen.findByText("线上版本仍在使用；有待发布更改。")).toBeInTheDocument();
  });

  it("does not carry an old page's inputs or write controls into another route while it loads", async () => {
    const view = mount(); await settings();
    vi.mocked(marketingApi.getPage).mockImplementationOnce(() => new Promise(() => {}));
    view.rerender(tree("page-2"));
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
    expect(screen.queryByText("LUW-001")).not.toBeInTheDocument();
  });

  it("opens real page-bound link records from the links step and offers the next step when none exist", async () => {
    vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mount(); await screen.findByText("LUW-001");
    clickStep("3 投放链接");
    expect(await screen.findByText("暂无符合条件的投放链接。")).toBeInTheDocument();
    expect(marketingApi.listLinks).toHaveBeenCalledWith(expect.objectContaining({ productId: "product-1", landingPageId: "page-1" }));
    expect(await screen.findByText("页面已发布，但尚未创建投放链接；创建后可区分不同广告的效果。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步：费用与效果" }));
    expect(await screen.findByRole("tab", { name: "广告费用" })).toBeInTheDocument();
  });

  it("shows the scheduled effective time on the links step", async () => {
    vi.mocked(marketingApi.getPage).mockResolvedValue({ ...row, effectiveStatus: "SCHEDULED", startAt: "2026-10-15T09:00:00+08:00" });
    mount(); await screen.findByText("LUW-001");
    clickStep("3 投放链接");
    expect(await screen.findByText(/页面将于 .* 生效；可以先建好链接。/)).toBeInTheDocument();
  });

  it("embeds this page's performance and links to compare and optimizer overviews with the current scope", async () => {
    mount(); await screen.findByText("LUW-001");
    clickStep("4 费用与效果");
    fireEvent.click(screen.getByRole("tab", { name: "本页效果" }));
    await waitFor(() => expect(marketingApi.performance).toHaveBeenCalledWith(expect.objectContaining({ view: "PRODUCT", productId: "product-1", landingPageId: "page-1" })));
    await waitFor(() => expect(screen.getByRole("link", { name: "商品比较" })).toHaveAttribute("href", "/admin/marketing/compare?productId=product-1&preset=LAST_7_DAYS"));
    expect(screen.getByRole("link", { name: "优化师总览" })).toHaveAttribute("href", "/admin/marketing/optimizers?owner=u1&preset=LAST_7_DAYS");
  });

  it("supports arrow/end/home navigation for the performance tabs", async () => {
    mount(); await screen.findByText("LUW-001");
    clickStep("4 费用与效果");
    await screen.findByText("暂无符合条件的费用记录；未录入不等于零费用。");
    const costs = screen.getByRole("tab", { name: "广告费用" }); costs.focus();
    fireEvent.keyDown(costs, { key: "ArrowRight" });
    const performance = screen.getByRole("tab", { name: "本页效果" });
    expect(performance).toHaveAttribute("aria-selected", "true"); expect(performance).toHaveFocus();
    await screen.findByRole("heading", { name: "本页效果" });
    fireEvent.keyDown(performance, { key: "Home" });
    expect(costs).toHaveAttribute("aria-selected", "true"); expect(costs).toHaveFocus();
    await screen.findByText("暂无符合条件的费用记录；未录入不等于零费用。");
  });

  it("lets finance inspect page expenses without exposing write controls", async () => {
    auth.admin.permissions = ["MARKETING_VIEW_ALL"];
    mount(); await screen.findByText("LUW-001");
    clickStep("4 费用与效果");
    fireEvent.click(screen.getByRole("tab", { name: "广告费用" }));
    await waitFor(() => expect(marketingApi.listCosts).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "录入费用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
  });

  it("validates unsaved formatting without saving, publishing or replacing the raw draft", async () => {
    vi.mocked(marketingApi.validate).mockResolvedValue(cleaned("<p>First draft</p>"));
    mount(); await screen.findByText("LUW-001");
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    await waitFor(() => expect(marketingApi.validate).toHaveBeenCalledExactlyOnceWith("page-1", expect.objectContaining({ blocks: expect.arrayContaining([expect.objectContaining({ props: { html: '<p onclick="bad()">First draft</p><script>bad()</script>' } })]) })));
    await waitFor(() => expect(screen.getByTestId("validated-preview")).toHaveTextContent("<p>First draft</p>"));
    expect(screen.getByTestId("editor-document").textContent).toContain('<script>bad()</script>');
    expect(marketingApi.saveDraft).not.toHaveBeenCalled(); expect(marketingApi.publish).not.toHaveBeenCalled();
    expect(screen.getByText("请先保存，再发布或同步母商品。")).toBeInTheDocument();
  });

  it("ignores a late validation response for older input", async () => {
    let resolveOld!: (content: LandingContent) => void;
    vi.mocked(marketingApi.validate).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(cleaned("<p>Second draft</p>"));
    mount(); await screen.findByText("LUW-001"); fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    await waitFor(() => expect(marketingApi.validate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Edit again" }));
    await waitFor(() => expect(screen.getByTestId("validated-preview")).toHaveTextContent("<p>Second draft</p>"));
    await act(async () => resolveOld(cleaned("<p>First draft</p>")));
    expect(screen.getByTestId("validated-preview")).toHaveTextContent("<p>Second draft</p>");
  });

  it("keeps unsaved content when only the editor language changes", async () => {
    mount(); await screen.findByText("LUW-001");
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    await screen.findByRole("button", { name: "Save draft" });
    expect(marketingApi.getPage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Update live version" })).toBeDisabled();
    expect(screen.getByTestId("editor-document").textContent).toContain("First draft");
  });

  it("keeps the current step when only the language changes", async () => {
    mount(); await screen.findByText("LUW-001");
    clickStep("2 预览发布");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(await screen.findByRole("button", { name: "2 Preview & publish" })).toHaveAttribute("aria-current", "step");
    expect(marketingApi.getPage).toHaveBeenCalledTimes(1);
  });

  it("keeps changed markup unapproved and preserves inputs when preview validation fails", async () => {
    vi.mocked(marketingApi.validate).mockRejectedValue(new AdminApiError("Invalid document", 400));
    mount(); await screen.findByText("LUW-001");
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    await screen.findByText("预览验证失败；修改的标记仅以文字显示，你的输入已保留。");
    expect(screen.getByTestId("validated-preview")).toHaveTextContent("null");
    expect(screen.getByTestId("editor-document").textContent).toContain('<script>bad()</script>');
    expect(marketingApi.saveDraft).not.toHaveBeenCalled(); expect(marketingApi.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "更新线上版本" })).toBeDisabled();
  });

  it("hides the previous account document immediately while the same route reloads", async () => {
    const view = mount(); await screen.findByText("LUW-001");
    vi.mocked(marketingApi.getPage).mockImplementationOnce(() => new Promise(() => {}));
    auth.admin.id = "u2";
    view.rerender(tree());
    expect(screen.queryByText("LUW-001")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
    await waitFor(() => expect(marketingApi.getPage).toHaveBeenCalledTimes(2));
  });

  it("allows saved content editing for inactive parents but refuses to show a false purchase preview", async () => {
    vi.mocked(marketingApi.getPage).mockResolvedValue({ ...row, productStatus: "DISABLED" });
    mount(); await screen.findByText("母商品未上架，购买预览与发布不可用。" );
    expect(screen.getByRole("button", { name: "更新线上版本" })).toBeDisabled();
    expect(marketingApi.getPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });
});
