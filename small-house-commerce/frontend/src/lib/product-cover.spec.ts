import { describe, expect, it } from "vitest";
import { productCoverMedia } from "./product-cover";

const image = {
  id: "img",
  url: "/uploads/catalog/2026/a.webp",
  type: "IMAGE" as const,
  altText: "A",
  sortOrder: 1,
};

const video = {
  id: "vid",
  url: "/uploads/catalog/2026/a.mp4",
  type: "VIDEO" as const,
  altText: null,
  sortOrder: 0,
};

describe("productCoverMedia", () => {
  it("returns the effective IMAGE cover as-is", () => {
    expect(
      productCoverMedia({ effectiveCoverMedia: image, images: [image] }),
    ).toEqual(image);
  });

  it("ignores a VIDEO effective cover and uses the first gallery image", () => {
    expect(
      productCoverMedia({ effectiveCoverMedia: video, images: [video, image] }),
    ).toEqual(image);
  });

  it("returns null when the product only carries video media", () => {
    expect(
      productCoverMedia({ effectiveCoverMedia: video, images: [video] }),
    ).toBeNull();
  });

  it("handles products without cover or gallery data", () => {
    expect(productCoverMedia({ effectiveCoverMedia: null })).toBeNull();
    expect(productCoverMedia(null)).toBeNull();
    expect(productCoverMedia(undefined)).toBeNull();
  });
});
