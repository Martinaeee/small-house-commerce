import { describe, expect, it } from "vitest";
import { fitHeroBoxes, flowHeroBoxes, heroTargetHeight } from "./homepage-hero-layout";

const screen = { mode: "SCREEN" as const, device: "mobile" as const, width: 390,
  viewportHeight: 844, shellTop: 112, shellBottom: 64, mediaRatio: 1.5 };

describe("Hero readable geometry", () => {
  it("flows long copy before both CTAs and stacks only buttons that do not fit", () => {
    const boxes = [
      { key: "heading" as const, left: 0, top: 0, width: 350, height: 120 },
      { key: "subheading" as const, left: 0, top: 0, width: 350, height: 78 },
      { key: "ctaPrimary" as const, left: 0, top: 0, width: 180, height: 48 },
      { key: "ctaSecondary" as const, left: 200, top: 0, width: 180, height: 48 },
    ];
    const narrow = flowHeroBoxes(boxes, { width: 390, height: 360, padding: 20, device: "mobile" });
    expect(narrow.boxes[1].top - narrow.boxes[0].top).toBe(132);
    expect(narrow.boxes[2].top - narrow.boxes[1].top).toBe(98);
    expect(narrow.boxes[3].left).toBe(20);
    expect(narrow.boxes[3].top - narrow.boxes[2].top).toBe(60);
    expect(narrow.height).toBeGreaterThan(360);
    const wide = flowHeroBoxes(boxes, { width: 900, height: 400, padding: 28, device: "tablet" });
    expect(wide.boxes[2].top).toBe(wide.boxes[3].top);
    expect(wide.boxes[3].left - wide.boxes[2].left).toBe(192);
  });
  it.each([
    ["desktop", 550.56], ["tablet", 568.32], ["mobile", 500],
  ] as const)("uses the rule-driven banner height for %s", (device, height) => {
    expect(heroTargetHeight({ ...screen, mode: "BANNER", device, viewportHeight: 1000, shellTop: 80, shellBottom: 32 })).toBeCloseTo(height);
  });
  it("subtracts actual shell space instead of reusing a fixed hero height", () => {
    expect(heroTargetHeight(screen)).toBe(668);
    expect(heroTargetHeight({ ...screen, viewportHeight: 180 })).toBe(4);
  });
  it("uses container width and the actual image ratio", () => {
    expect(heroTargetHeight({ ...screen, mode: "NATURAL", width: 1200, device: "desktop", mediaRatio: 2 })).toBe(600);
  });
  it("uses a device ratio only while image metadata is unavailable", () => {
    expect(heroTargetHeight({ ...screen, mode: "NATURAL", mediaRatio: null })).toBe(487.5);
  });
  it("expands rather than hiding a colliding over-image CTA", () => {
    const input = [
      { key: "heading" as const, left: 20, top: 30, width: 350, height: 220 },
      { key: "ctaPrimary" as const, left: 20, top: 150, width: 350, height: 48 },
    ];
    const result = fitHeroBoxes(input, { width: 390, height: 180, padding: 16, gap: 12 });
    expect(result.boxes[1].top).toBe(262);
    expect(result.height).toBe(326);
    expect(input[1].top).toBe(150);
  });
  it("keeps fitting side-by-side buttons side by side", () => {
    const result = fitHeroBoxes([
      { key: "ctaPrimary", left: 16, top: 120, width: 160, height: 48 },
      { key: "ctaSecondary", left: 190, top: 120, width: 160, height: 48 },
    ], { width: 390, height: 300, padding: 16, gap: 12 });
    expect(result.boxes.map(({ top }) => top)).toEqual([120, 120]);
    expect(result.height).toBe(300);
  });
  it("clamps an off-edge box without increasing page width", () => {
    const result = fitHeroBoxes([
      { key: "heading", left: 300, top: -10, width: 350, height: 60 },
    ], { width: 375, height: 300, padding: 16, gap: 12 });
    expect(result.boxes[0]).toEqual({ key: "heading", left: 16, top: 16, width: 343, height: 60 });
  });
});
