import { describe, expect, it, vi } from "vitest";
import LegacyCampaignLinks from "./page";
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
describe("legacy campaign link entry", () => {
  it("redirects to persisted links rather than the free-form AID builder", async () => {
    await LegacyCampaignLinks({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenLastCalledWith("/admin/marketing/links");
  });
  it("preserves safely encoded product and page association", async () => {
    await LegacyCampaignLinks({ searchParams: Promise.resolve({ productId: "product/1", landingPageId: "page/1" }) });
    expect(redirect).toHaveBeenLastCalledWith("/admin/marketing/links?productId=product%2F1&landingPageId=page%2F1");
  });
});
