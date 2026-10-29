import { describe, expect, it } from "vitest";
import { optimizedUploadImage } from "./image-url";

describe("optimizedUploadImage", () => {
  it("rewrites local upload paths to the Next image optimizer", () => {
    expect(optimizedUploadImage("/uploads/catalog/2026/abc.png", 640))
      .toBe(`/_next/image?url=${encodeURIComponent("/uploads/catalog/2026/abc.png")}&w=640&q=75`);
  });
  it("passes through absolute/external URLs untouched", () => {
    expect(optimizedUploadImage("https://cdn.example.com/x.png", 640)).toBe("https://cdn.example.com/x.png");
  });
  it("passes through non-upload local paths untouched", () => {
    expect(optimizedUploadImage("/brand-mark", 64)).toBe("/brand-mark");
  });
  it("rewrites bundled about photography too", () => {
    expect(optimizedUploadImage("/about/our-story.jpg", 1440))
      .toBe(`/_next/image?url=${encodeURIComponent("/about/our-story.jpg")}&w=1440&q=75`);
  });
});
