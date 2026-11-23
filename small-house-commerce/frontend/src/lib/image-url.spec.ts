import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizedUploadImage } from "./image-url";

afterEach(() => vi.unstubAllEnvs());

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
  it("routes media-base URLs through the optimizer when the base is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "https://luwagshop-1257828062.cos.ap-singapore.myqcloud.com");
    vi.resetModules();
    const { optimizedUploadImage: withBase } = await import("./image-url");
    const url = "https://luwagshop-1257828062.cos.ap-singapore.myqcloud.com/catalog/2026/abc.png";
    expect(withBase(url, 640)).toBe(
      `/_next/image?url=${encodeURIComponent(url)}&w=640&q=75`,
    );
  });
  it("keeps other hosts untouched even when the media base is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "https://luwagshop-1257828062.cos.ap-singapore.myqcloud.com");
    vi.resetModules();
    const { optimizedUploadImage: withBase } = await import("./image-url");
    expect(withBase("https://cdn.example.com/x.png", 640)).toBe("https://cdn.example.com/x.png");
  });
});
