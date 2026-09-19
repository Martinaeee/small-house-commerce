import { describe, expect, it } from "vitest";
import { resolveUploadType } from "@/components/admin/ImageUrlInput";

/**
 * Regression cover for picking a file the browser cannot type.
 *
 * `File.type` is empty for plenty of real-world videos — files copied off
 * Android/SD cards, anything whose extension the OS has no mapping for, and
 * some .mov exports. Testing membership in a MIME allowlist therefore rejected
 * perfectly good videos before the upload was ever attempted, and the operator
 * saw "仅支持 MP4 / WebM / MOV 视频" for an MP4.
 */
describe("resolveUploadType", () => {
  it("accepts a video the browser typed correctly", () => {
    expect(resolveUploadType("holiday.mp4", "video/mp4", "video")).toBe("video/mp4");
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(resolveUploadType("holiday.mp4", "", "video")).toBe("video/mp4");
    expect(resolveUploadType("clip.MOV", "", "video")).toBe("video/quicktime");
    expect(resolveUploadType("clip.webm", "", "video")).toBe("video/webm");
  });

  it("falls back to the extension for images too", () => {
    expect(resolveUploadType("shot.JPG", "", "image")).toBe("image/jpeg");
    expect(resolveUploadType("shot.png", "", "image")).toBe("image/png");
    expect(resolveUploadType("shot.webp", "", "image")).toBe("image/webp");
  });

  it("still rejects a genuinely unsupported file", () => {
    expect(resolveUploadType("notes.pdf", "application/pdf", "video")).toBeNull();
    expect(resolveUploadType("movie.avi", "", "video")).toBeNull();
    expect(resolveUploadType("archive.zip", "application/zip", "image")).toBeNull();
  });

  it("rejects a video picked for an image slot even when the extension matches", () => {
    // The accept attribute already filters the picker; a drag-drop or a stale
    // file dialog can still hand one over.
    expect(resolveUploadType("holiday.mp4", "video/mp4", "image")).toBeNull();
  });

  it("does not let a mismatched MIME type override a good extension", () => {
    // Some browsers report application/octet-stream for known-good videos.
    expect(resolveUploadType("holiday.mp4", "application/octet-stream", "video")).toBe(
      "video/mp4",
    );
  });
});
