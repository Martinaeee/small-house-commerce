import { describe, expect, it } from "vitest";
import { groupLinksBySource } from "@/lib/marketing-link-groups";
import type { CampaignLinkRow } from "@/lib/marketing-api";

const base: CampaignLinkRow = {
  id: "x", code: "c", name: "n", sourceType: "FB_POST", productId: "p1", productName: "Chair", productCode: "P-1",
  productThumbnailUrl: null, variantId: null, variantNameSnapshot: null, landingPageId: null, pageName: null,
  ownerUserId: "u1", ownerName: "Optimizer", aid: "OP-1", path: "/products/chair?cl=c", status: "ACTIVE", version: 1,
  createdAt: "2026-11-03T01:00:00Z", updatedAt: "2026-11-03T01:00:00Z", postDate: "2026-11-03", postUrl: null, archivedAt: null,
};
const row = (over: Partial<CampaignLinkRow>): CampaignLinkRow => ({ ...base, ...over });

describe("groupLinksBySource", () => {
  it("orders Facebook posts before Meta ads and drops empty groups", () => {
    const groups = groupLinksBySource([
      row({ id: "m1", sourceType: "META_AD", postDate: null, createdAt: "2026-11-03T02:00:00Z" }),
      row({ id: "f1", sourceType: "FB_POST", postDate: "2026-11-04" }),
    ]);
    expect(groups.map(group => group.key)).toEqual(["FB_POST", "META_AD"]);
    expect(groups[0].rows.map(entry => entry.id)).toEqual(["f1"]);
    expect(groups[1].rows.map(entry => entry.id)).toEqual(["m1"]);
  });

  it("sorts Facebook posts newest first with undated posts last", () => {
    const groups = groupLinksBySource([
      row({ id: "undated", postDate: null }),
      row({ id: "older", postDate: "2026-10-01" }),
      row({ id: "newer", postDate: "2026-11-04" }),
    ]);
    expect(groups[0].rows.map(entry => entry.id)).toEqual(["newer", "older", "undated"]);
  });

  it("sorts Meta ads and other sources by creation time", () => {
    const groups = groupLinksBySource([
      row({ id: "old", sourceType: "META_AD", postDate: null, createdAt: "2026-10-01T00:00:00Z" }),
      row({ id: "new", sourceType: "META_AD", postDate: null, createdAt: "2026-11-02T00:00:00Z" }),
      row({ id: "org", sourceType: "ORGANIC", postDate: null, createdAt: "2026-11-01T00:00:00Z" }),
    ]);
    expect(groups.map(group => group.key)).toEqual(["META_AD", "OTHER"]);
    expect(groups[0].rows.map(entry => entry.id)).toEqual(["new", "old"]);
    expect(groups[1].rows.map(entry => entry.id)).toEqual(["org"]);
  });
});
