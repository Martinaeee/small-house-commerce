import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/api";
import type { LandingMedia } from "./marketing-content";
import { selectLandingMedia } from "./marketing-media";

const parent: Pick<Product, "variants" | "options"> = {
  options: [{ id: "color", name: "Color", kind: "COLOR", position: 0, presentation: "TEXT", isMediaDriver: true, values: [{ id: "blue", label: "Blue", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null }] }],
  variants: [{ id: "v1", name: "Blue", position: 0, combinationKey: "color:blue", optionValueIds: ["blue"], sku: { id: "sku1", skuCode: "BLUE", status: "ACTIVE", price: 100, compareAtPrice: null, availableInventory: 2 } }],
};
const image = (url: string, extra: Partial<LandingMedia> = {}): LandingMedia => ({ url, type: "IMAGE", altText: null, optionValueId: null, variantId: null, ...extra });
const shared = image("/uploads/shared.jpg");
const option = image("/uploads/blue.jpg", { optionValueId: "blue" });
const variant = image("/uploads/blue-v1.jpg", { variantId: "v1" });

describe("independent landing media", () => {
  it("replaces rather than merges selected variant, option and shared scopes", () => {
    const media = [shared, option, variant];
    expect(selectLandingMedia(media, parent, { color: "blue" }, "v1").media).toEqual([variant]);
    expect(selectLandingMedia([shared, option], parent, { color: "blue" }, "v1").media).toEqual([option]);
    expect(selectLandingMedia(media, parent, {}, null).media).toEqual([shared]);
  });

  it("diagnoses removed or disabled bindings without breaking valid shared media", () => {
    const unavailable = { ...parent, variants: [] };
    const result = selectLandingMedia([shared, option, variant], unavailable, {}, null);
    expect(result.media).toEqual([shared]);
    expect(result.staleBindingCount).toBe(2);
  });

  it("does not request unsafe unsaved media URLs", () => {
    const result = selectLandingMedia([shared, image("javascript:bad()"), image("//evil.test/a.jpg"), image("/\\evil.test/a.jpg"), image("/uploads/a\nb.jpg")], parent, {}, null);
    expect(result.media).toEqual([shared]);
    expect(result.blockedUrlCount).toBe(4);
  });

  it("shows only shared media while live product information is unavailable", () => {
    expect(selectLandingMedia([shared, variant], null, {}, null).media).toEqual([shared]);
  });
});
