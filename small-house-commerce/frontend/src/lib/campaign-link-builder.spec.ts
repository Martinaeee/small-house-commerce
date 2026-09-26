import { describe, expect, it } from "vitest";
import {
  buildCampaignLinks,
  type CampaignLinkContext,
} from "./campaign-link-builder";

const context: CampaignLinkContext = {
  products: [
    {
      id: "00000000-0000-7000-8000-000000000001",
      name: "Compact Chair",
      slug: "compact-chair",
      variants: [
        {
          id: "00000000-0000-7000-8000-000000000002",
          name: "Red / Small",
        },
        {
          id: "00000000-0000-7000-8000-000000000005",
          name: "Blue / Large",
        },
      ],
      landingPages: [
        {
          id: "00000000-0000-7000-8000-000000000003",
          slug: "compact-chair-red",
          title: "Compact Chair for Condos",
        },
      ],
    },
    {
      id: "00000000-0000-7000-8000-000000000004",
      name: "Storage Shelf",
      slug: "storage-shelf",
      variants: [],
      landingPages: [],
    },
  ],
};

const validInput = {
  productId: "00000000-0000-7000-8000-000000000001",
  variantId: "00000000-0000-7000-8000-000000000002",
  landingPageId: "",
  aid: "optimizer-a",
  campaignId: "campaign-2026",
  adsetId: "adset-7",
  adId: "ad-9",
  utmSource: "facebook",
  utmMedium: "paid-social",
  utmCampaign: "condo-chair",
};

describe("buildCampaignLinks", () => {
  it("builds product, real variant and campaign links with canonical attribution keys", () => {
    const result = buildCampaignLinks(context, validInput);

    expect(result).toEqual({
      ok: true,
      links: {
        product: "https://luwag.ph/products/compact-chair",
        variant:
          "https://luwag.ph/products/compact-chair?variant=00000000-0000-7000-8000-000000000002",
        campaign:
          "https://luwag.ph/products/compact-chair?variant=00000000-0000-7000-8000-000000000002&aid=optimizer-a&campaign_id=campaign-2026&adset_id=adset-7&ad_id=ad-9&utm_source=facebook&utm_medium=paid-social&utm_campaign=condo-chair",
      },
    });
  });

  it("uses a real landing-page path without inventing a landing-page query key", () => {
    const result = buildCampaignLinks(context, {
      ...validInput,
      landingPageId: "00000000-0000-7000-8000-000000000003",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const campaign = new URL(result.links.campaign);
    expect(campaign.pathname).toBe("/lp/compact-chair-red");
    expect(campaign.searchParams.has("landingPageId")).toBe(false);
    expect(campaign.searchParams.has("landing_page_id")).toBe(false);
  });

  it("encodes Unicode and reserved characters exactly once without duplicate keys", () => {
    const result = buildCampaignLinks(context, {
      ...validInput,
      aid: "优化师 A&B",
      campaignId: "launch/09?phase=1",
      utmSource: "Meta Ads / PH",
      utmCampaign: "Condo + Chair",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const campaign = new URL(result.links.campaign);
    expect(campaign.searchParams.get("aid")).toBe("优化师 A&B");
    expect(campaign.searchParams.get("campaign_id")).toBe(
      "launch/09?phase=1",
    );
    expect(campaign.searchParams.get("utm_source")).toBe("Meta Ads / PH");
    expect(campaign.searchParams.get("utm_campaign")).toBe("Condo + Chair");
    for (const key of [
      "variant",
      "aid",
      "campaign_id",
      "adset_id",
      "ad_id",
      "utm_source",
      "utm_medium",
      "utm_campaign",
    ]) {
      expect(campaign.searchParams.getAll(key), key).toHaveLength(1);
    }
  });

  it("omits blank optional attribution fields rather than emitting empty values", () => {
    const result = buildCampaignLinks(context, {
      ...validInput,
      variantId: "",
      campaignId: "",
      adsetId: "  ",
      adId: "",
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.links.variant).toBeNull();
    const campaign = new URL(result.links.campaign);
    expect([...campaign.searchParams.entries()]).toEqual([
      ["aid", "optimizer-a"],
    ]);
  });

  it("accepts the real free-form AID contract without an invented allowlist", () => {
    const result = buildCampaignLinks(context, {
      ...validInput,
      aid: "new-optimizer-code-2026",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new URL(result.links.campaign).searchParams.get("aid")).toBe(
      "new-optimizer-code-2026",
    );
  });

  it("rejects an empty AID before producing campaign links", () => {
    expect(buildCampaignLinks(context, { ...validInput, aid: "  " })).toEqual({
      ok: false,
      errors: { aid: "AID_REQUIRED" },
    });
  });

  it("rejects variants and landing pages outside the selected product", () => {
    expect(
      buildCampaignLinks(context, {
        ...validInput,
        productId: "00000000-0000-7000-8000-000000000004",
        variantId: "00000000-0000-7000-8000-000000000002",
        landingPageId: "00000000-0000-7000-8000-000000000003",
      }),
    ).toEqual({
      ok: false,
      errors: {
        variantId: "VARIANT_INVALID",
        landingPageId: "LANDING_PAGE_INVALID",
      },
    });
  });

  it("rejects unknown products and the backend attribution length limits", () => {
    expect(
      buildCampaignLinks(context, {
        ...validInput,
        productId: "missing",
        aid: "a".repeat(65),
        campaignId: "c".repeat(65),
        adsetId: "s".repeat(65),
        adId: "d".repeat(65),
        utmSource: "u".repeat(121),
        utmMedium: "m".repeat(121),
        utmCampaign: "p".repeat(121),
      }),
    ).toEqual({
      ok: false,
      errors: {
        productId: "PRODUCT_INVALID",
        aid: "AID_TOO_LONG",
        campaignId: "CAMPAIGN_ID_TOO_LONG",
        adsetId: "ADSET_ID_TOO_LONG",
        adId: "AD_ID_TOO_LONG",
        utmSource: "UTM_SOURCE_TOO_LONG",
        utmMedium: "UTM_MEDIUM_TOO_LONG",
        utmCampaign: "UTM_CAMPAIGN_TOO_LONG",
      },
    });
  });
});
