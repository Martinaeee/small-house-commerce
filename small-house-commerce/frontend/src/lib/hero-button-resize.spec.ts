import { describe, expect, it } from "vitest";
import {
  computeButtonResize,
  type ButtonResizeLimits,
  type ButtonResizeStart,
  type ResizeDirection,
} from "@/lib/hero-button-resize";

const START: ButtonResizeStart = {
  width: 160,
  height: 48,
  fontSize: 14,
  paddingX: 28,
  paddingY: 14,
};

const LIMITS: ButtonResizeLimits = {
  minWidth: 60,
  minHeight: 24,
  maxWidth: 1200,
  maxHeight: 400,
  minFontSize: 8,
  maxFontSize: 200,
};

function resize(
  direction: ResizeDirection,
  dx: number,
  dy: number,
  overrides: {
    start?: Partial<ButtonResizeStart>;
    limits?: Partial<ButtonResizeLimits>;
  } = {},
) {
  return computeButtonResize({
    direction,
    start: { ...START, ...overrides.start },
    limits: { ...LIMITS, ...overrides.limits },
    dx,
    dy,
  });
}

describe("computeButtonResize", () => {
  it("changes only the width when dragging an east edge", () => {
    const result = resize("e", 40, 999);
    expect(result.width).toBe(200);
    expect(result.height).toBe(48);
    expect(result.fontSize).toBe(14);
    expect(result.paddingX).toBe(28);
    expect(result.paddingY).toBe(14);
    expect(result.scaledType).toBe(false);
  });

  it("grows the width when dragging the west edge to the left", () => {
    const result = resize("w", -30, 0);
    expect(result.width).toBe(190);
    expect(result.fontSize).toBe(14);
    expect(result.scaledType).toBe(false);
  });

  it("shrinks the width when dragging the west edge to the right", () => {
    const result = resize("w", 30, 0);
    expect(result.width).toBe(130);
  });

  it("changes only the height when dragging a south edge", () => {
    const result = resize("s", 999, 20);
    expect(result.height).toBe(68);
    expect(result.width).toBe(160);
    expect(result.fontSize).toBe(14);
    expect(result.scaledType).toBe(false);
  });

  it("grows the height when dragging the north edge upward", () => {
    const result = resize("n", 0, -20);
    expect(result.height).toBe(68);
  });

  it("scales width, height, font size and paddings together on a corner", () => {
    const result = resize("se", -30, -9);
    expect(result.width).toBe(130);
    expect(result.height).toBe(39);
    expect(result.fontSize).toBe(11.4);
    expect(result.paddingX).toBe(22.8);
    expect(result.paddingY).toBe(11.4);
    expect(result.scaledType).toBe(true);
  });

  it("matches the 160x48 at 75% example from the brief", () => {
    const result = resize("se", -40, -12);
    expect(result.width).toBe(120);
    expect(result.height).toBe(36);
    expect(result.fontSize).toBe(10.5);
    expect(result.paddingX).toBe(21);
    expect(result.paddingY).toBe(10.5);
  });

  it("uses the dominant axis when one corner delta is larger", () => {
    const result = resize("se", 40, 0);
    // width ratio 200/160 = 1.25, height ratio 48/48 = 1 → factor 1.25
    expect(result.width).toBe(200);
    expect(result.height).toBe(60);
    expect(result.fontSize).toBe(17.5);
  });

  it("stops shrinking at the minimum font size instead of overflowing the text", () => {
    const result = resize("se", -140, -42);
    expect(result.fontSize).toBe(8);
    expect(result.width).toBe(Math.round((160 * 8) / 14));
    expect(result.height).toBe(Math.round((48 * 8) / 14));
    expect(result.clamped).toBe(true);
  });

  it("clamps a width drag at the measured content minimum", () => {
    const result = resize("e", -500, 0, { limits: { minWidth: 120 } });
    expect(result.width).toBe(120);
    expect(result.clamped).toBe(true);
  });

  it("never returns a height below the 44px tap target on an edge drag", () => {
    const result = resize("s", 0, -500, { limits: { minHeight: 44 } });
    expect(result.height).toBe(44);
    expect(result.clamped).toBe(true);
  });

  it("clamps growth at the configured maximum", () => {
    const result = resize("e", 5000, 0, { limits: { maxWidth: 300 } });
    expect(result.width).toBe(300);
    expect(result.clamped).toBe(true);
  });

  it("keeps results finite for degenerate starts", () => {
    const result = resize("se", 10, 10, {
      start: { width: 0, height: 0, fontSize: 0, paddingX: 0, paddingY: 0 },
    });
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
    expect(Number.isFinite(result.fontSize)).toBe(true);
    expect(Number.isFinite(result.paddingX)).toBe(true);
  });
});
