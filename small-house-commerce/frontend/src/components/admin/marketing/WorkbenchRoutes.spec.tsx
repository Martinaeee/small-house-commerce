import { describe, expect, it, vi } from "vitest";
import WorkbenchPage from "@/app/admin/(shell)/marketing/page";
import LinksPage from "@/app/admin/(shell)/marketing/links/page";
import CostsPage from "@/app/admin/(shell)/marketing/costs/page";
import ReportsPage from "@/app/admin/(shell)/marketing/reports/page";
import ComparePage from "@/app/admin/(shell)/marketing/compare/page";
import OptimizersPage from "@/app/admin/(shell)/marketing/optimizers/page";
import LegacyPages from "@/app/admin/(shell)/single-pages/page";
import LegacyLinks from "@/app/admin/(shell)/link-builder/page";
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
describe("marketing route association", () => {
  it("resolves product and page context without server fetching private records", async () => {
    const pages = await WorkbenchPage({ searchParams: Promise.resolve({ productId: "p1" }) });
    expect(pages.props).toMatchObject({ productId: "p1", view: "pages" });
    const links = await LinksPage({ searchParams: Promise.resolve({ productId: "p1", landingPageId: "lp1" }) });
    expect(links.props).toMatchObject({ productId: "p1", landingPageId: "lp1", view: "links" });
    const costs = await CostsPage({ searchParams: Promise.resolve({ productId: "p1", landingPageId: "lp1", linkId: "link-1" }) });
    expect(costs.props).toMatchObject({ productId: "p1", landingPageId: "lp1", linkId: "link-1", view: "costs" });
    const reports = await ReportsPage({ searchParams: Promise.resolve({ productId: "p1", landingPageId: "lp1", linkId: "link-1" }) });
    expect(reports.props).toMatchObject({ productId: "p1", landingPageId: "lp1", linkId: "link-1", view: "reports" });
  });
  it("associates the compare and optimizer entries and whitelists their query parameters", async () => {
    const compare = await ComparePage({ searchParams: Promise.resolve({ productId: "p1", landingPageId: "lp1", linkId: "link-1", preset: "CUSTOM", from: "2026-10-01", to: "2026-10-07", page: "5", sortBy: "visits" }) });
    expect(compare.props).toMatchObject({ view: "compare", productId: "p1", preset: "CUSTOM", from: "2026-10-01", to: "2026-10-07" });
    expect(compare.props).not.toHaveProperty("landingPageId");
    expect(compare.props).not.toHaveProperty("linkId");
    expect(compare.props).not.toHaveProperty("page");
    expect(compare.props).not.toHaveProperty("sortBy");
    const optimizers = await OptimizersPage({ searchParams: Promise.resolve({ owner: "u1", productId: "p1", preset: "LAST_WEEK" }) });
    expect(optimizers.props).toMatchObject({ view: "optimizers", ownerUserId: "u1", preset: "LAST_WEEK" });
    expect(optimizers.props).not.toHaveProperty("productId");
    const badPreset = await ComparePage({ searchParams: Promise.resolve({ preset: "EVERYTHING" }) });
    expect(badPreset.props).toMatchObject({ view: "compare", preset: "LAST_7_DAYS" });
  });
  it("preserves product context when retiring old entry points", async () => {
    await LegacyPages({ searchParams: Promise.resolve({ productId: "product/1" }) });
    expect(redirect).toHaveBeenLastCalledWith("/admin/marketing?productId=product%2F1");
    await LegacyLinks({ searchParams: Promise.resolve({ productId: "product/1", landingPageId: "page/1" }) });
    expect(redirect).toHaveBeenLastCalledWith("/admin/marketing/links?productId=product%2F1&landingPageId=page%2F1");
  });
});
