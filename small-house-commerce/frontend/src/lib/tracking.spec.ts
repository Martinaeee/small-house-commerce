import { beforeEach, describe, expect, it } from "vitest";
import {
  LANDING_PAGE_STORAGE_KEY,
  readAttribution,
} from "./tracking";

describe("readAttribution canonical URL contract", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("parses every canonical link-builder key and the persisted landing page", () => {
    window.localStorage.setItem(
      LANDING_PAGE_STORAGE_KEY,
      "00000000-0000-7000-8000-000000000003",
    );
    window.history.replaceState(
      {},
      "",
      "/products/chair?aid=optimizer-a&campaign_id=campaign-1&adset_id=adset-2&ad_id=ad-3&utm_source=facebook&utm_medium=paid-social&utm_campaign=chair-launch",
    );

    expect(readAttribution()).toEqual({
      aid: "optimizer-a",
      campaignId: "campaign-1",
      adsetId: "adset-2",
      adId: "ad-3",
      utmSource: "facebook",
      utmMedium: "paid-social",
      utmCampaign: "chair-launch",
      landingPageId: "00000000-0000-7000-8000-000000000003",
    });
  });

  it("keeps ad_id canonical while retaining the existing adid fallback", () => {
    window.history.replaceState(
      {},
      "",
      "/products/chair?ad_id=canonical&adid=legacy",
    );
    expect(readAttribution().adId).toBe("canonical");

    window.history.replaceState({}, "", "/products/chair?adid=legacy");
    expect(readAttribution().adId).toBe("legacy");
  });
});
