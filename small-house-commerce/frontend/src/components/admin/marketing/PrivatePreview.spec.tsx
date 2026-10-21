import { describe, expect, it } from "vitest";
import config from "../../../../next.config";
import PreviewPage, { metadata } from "@/app/admin/(shell)/marketing/[id]/preview/page";
import MarketingPreview from "@/components/admin/marketing/MarketingPreview";
import EditPage from "@/app/admin/(shell)/marketing/[id]/edit/page";
import MarketingPageEdit from "@/components/admin/marketing/MarketingPageEdit";
describe("private marketing preview route", () => {
  it("passes resolved route identity into the full editor", async () => {
    const page = await EditPage({ params: Promise.resolve({ id: "page-1" }) });
    expect(page.type).toBe(MarketingPageEdit);
    expect(page.props).toEqual({ pageId: "page-1" });
  });
  it("passes only the resource identity to an authenticated client and never server-fetches a draft", async () => {
    const page = await PreviewPage({ params: Promise.resolve({ id: "page-1" }) });
    expect(page.type).toBe(MarketingPreview);
    expect(page.props).toEqual({ pageId: "page-1" });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it("sets no-store and no-referrer on the actual browser document route", async () => {
    const rules = await config.headers?.();
    expect(rules).toContainEqual({ source: "/admin/marketing/:path*", headers: [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] });
  });
});
