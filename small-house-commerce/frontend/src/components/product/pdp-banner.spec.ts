import { describe, expect, it } from "vitest";
import { readableTextColor, resolvePdpBanner } from "./pdp-banner";

describe("PDP banner", () => {
  it("hides disabled and unfinished banners", () => {
    expect(resolvePdpBanner({ pdpBannerEnabled: false, pdpBannerText: "Sale" })).toBeNull();
    expect(resolvePdpBanner({ pdpBannerEnabled: true, pdpBannerText: "  " })).toBeNull();
  });

  it("defaults to the campaign red with white copy", () => {
    expect(resolvePdpBanner({ pdpBannerEnabled: true, pdpBannerText: "Sale" })).toEqual({
      text: "Sale", background: "var(--color-sale)", textColor: "#ffffff",
    });
  });

  it("uses authored copy and colours without interpreting markup", () => {
    expect(resolvePdpBanner({ pdpBannerEnabled: true, pdpBannerText: "  <b>Sale</b>  ",
      pdpBannerBackground: "#123456", pdpBannerTextColor: "#fedcba" })).toEqual({
      text: "<b>Sale</b>", background: "#123456", textColor: "#fedcba",
    });
  });

  it.each([
    ["#ffffff", "#000000"], ["#000000", "#ffffff"],
    ["#aaaaaa", "#000000"], ["#244c3c", "#ffffff"],
  ])("chooses readable black/white text for %s", (background, expected) => {
    expect(readableTextColor(background)).toBe(expected);
  });
});
