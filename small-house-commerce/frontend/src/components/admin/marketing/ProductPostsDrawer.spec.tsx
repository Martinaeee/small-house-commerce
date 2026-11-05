import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductPostsDrawer } from "@/components/admin/marketing/ProductPostsDrawer";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { copyText } from "@/lib/clipboard";
import { marketingApi, type CampaignLinkRow, type CampaignLinkQuery } from "@/lib/marketing-api";

const auth = vi.hoisted(() => ({ admin: { id: "u1", name: "Operator", permissions: ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"] } }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({ useAdminAuth: () => auth }));
vi.mock("@/lib/marketing-api", async load => ({ ...await load(), marketingApi: { listLinks: vi.fn(), archiveLink: vi.fn(), unarchiveLink: vi.fn(), disableLink: vi.fn(), createShortLink: vi.fn() } }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

const base: CampaignLinkRow = {
  id: "x", code: "c", adid: "FB-OP-1-261103-01", name: "n", sourceType: "FB_POST", productId: "p1", productName: "Chair", productCode: "P-1",
  productThumbnailUrl: null, variantId: null, variantNameSnapshot: null, landingPageId: null, pageName: null,
  ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", path: "/products/chair?cl=c", status: "ACTIVE", version: 1,
  createdAt: "2026-11-03T01:00:00Z", updatedAt: "2026-11-03T01:00:00Z", postDate: "2026-11-03", postUrl: null, archivedAt: null,
};
const row = (over: Partial<CampaignLinkRow>): CampaignLinkRow => ({ ...base, ...over });
const filters: CampaignLinkQuery = { productId: "p1", archiveState: "ALL" };
const mount = () => render(<AdminI18nProvider><ProductPostsDrawer productId="p1" productName="Chair" filters={filters} onClose={vi.fn()} onChanged={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} /></AdminI18nProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(marketingApi.listLinks).mockResolvedValue({
    items: [
      row({ id: "f2", name: "1104 视频发帖", postDate: "2026-11-04" }),
      row({ id: "m1", name: "CH002 广告", sourceType: "META_AD", postDate: null, createdAt: "2026-11-03T05:00:00Z" }),
      row({ id: "f1", name: "1104 发帖", postDate: "2026-11-04" }),
      row({ id: "o1", name: "自然来源", sourceType: "ORGANIC", postDate: null, createdAt: "2026-11-01T00:00:00Z" }),
      row({ id: "m2", name: "老广告", sourceType: "META_AD", postDate: null, createdAt: "2026-10-20T00:00:00Z" }),
    ],
    total: 5, page: 1, pageSize: 100,
  });
});

describe("product post drawer grouping", () => {
  it("splits the records into Facebook, Meta and other source sections in that order", async () => {
    mount();
    const facebook = await screen.findByRole("region", { name: /Facebook 发帖/ });
    const meta = screen.getByRole("region", { name: /Meta 广告/ });
    const other = screen.getByRole("region", { name: /其他来源/ });
    expect(within(facebook).getAllByRole("article")).toHaveLength(2);
    expect(within(meta).getAllByRole("article")).toHaveLength(2);
    expect(within(other).getAllByRole("article")).toHaveLength(1);
    expect(facebook.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(meta.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides a section that has no records and keeps the total count", async () => {
    vi.mocked(marketingApi.listLinks).mockResolvedValue({
      items: [row({ id: "f1", name: "1104 发帖", postDate: "2026-11-04" }), row({ id: "undated", name: "1029-Orange", postDate: null })],
      total: 2, page: 1, pageSize: 100,
    });
    mount();
    const facebook = await screen.findByRole("region", { name: /Facebook 发帖/ });
    expect(within(facebook).getAllByRole("article")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: /Meta 广告/ })).not.toBeInTheDocument();
    expect(screen.getByText(/2 条记录/)).toBeInTheDocument();
  });

  it("collapses one section without touching the others", async () => {
    mount();
    const facebook = await screen.findByRole("region", { name: /Facebook 发帖/ });
    const meta = screen.getByRole("region", { name: /Meta 广告/ });
    const toggle = within(meta).getByRole("button", { name: /Meta 广告/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(meta).getAllByRole("article")).toHaveLength(2);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(meta).queryAllByRole("article")).toHaveLength(0);
    expect(within(facebook).getAllByRole("article")).toHaveLength(2);
    expect(within(meta).getByText("2 条")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(meta).getAllByRole("article")).toHaveLength(2);
  });
  it("loads every record for the product instead of the first page only", async () => {
    mount();
    await screen.findByRole("region", { name: /Facebook 发帖/ });
    expect(marketingApi.listLinks).toHaveBeenCalledWith(expect.objectContaining({ productId: "p1", page: 1, pageSize: 100, orderBy: "POST_DATE_DESC" }));
  });
  it("shows the advertising number of each post and copies it", async () => {
    mount();
    await screen.findByText("1104 发帖");
    expect(screen.getAllByText("FB-OP-1-261103-01").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "复制编号" })[0]!);
    await waitFor(() => expect(vi.mocked(copyText)).toHaveBeenCalledWith("FB-OP-1-261103-01"));
  });
});
