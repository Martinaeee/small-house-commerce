import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND_MARK_SVG,
  DEFAULT_BRAND_MARK_VERSION,
} from "./default-brand-mark";

describe("default brand mark", () => {
  it("draws the cream roof on the brand green tile instead of the old brown square", () => {
    expect(DEFAULT_BRAND_MARK_SVG).toContain('viewBox="0 0 32 32"');
    expect(DEFAULT_BRAND_MARK_SVG).toContain('fill="#244c3c"');
    expect(DEFAULT_BRAND_MARK_SVG).toContain('stroke="#faf8f5"');
    expect(DEFAULT_BRAND_MARK_SVG).not.toContain("#6B4F3A");
  });

  it("keeps the standalone app icon in sync with the served default", () => {
    const icon = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");

    expect(icon.trim()).toBe(DEFAULT_BRAND_MARK_SVG);
  });

  it("stamps a version into the default payload so cached clients refresh", () => {
    expect(DEFAULT_BRAND_MARK_VERSION).toMatch(/^[a-z0-9-]+$/);
    expect(DEFAULT_BRAND_MARK_VERSION).not.toBe("1");
  });
});
