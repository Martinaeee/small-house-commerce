import { describe, expect, it } from "vitest";
import { resizeZoneRect, zoneRectFromDrag } from "./hero-zone-layout";

// The link zone is a rectangle in the slide's percentage space. These two
// helpers are the whole geometry contract: a drag paints a new box, a corner
// drag re-shapes an existing one.

const RECT = { xPct: 20, yPct: 30, widthPct: 40, heightPct: 25 };

describe("zoneRectFromDrag", () => {
  it("reads the box from the two ends of the drag, whichever way it went", () => {
    expect(zoneRectFromDrag(10, 20, 50, 60)).toEqual({
      xPct: 10,
      yPct: 20,
      widthPct: 40,
      heightPct: 40,
    });
    expect(zoneRectFromDrag(50, 60, 10, 20)).toEqual({
      xPct: 10,
      yPct: 20,
      widthPct: 40,
      heightPct: 40,
    });
  });
});

describe("resizeZoneRect", () => {
  it("grows the box from the dragged corner", () => {
    expect(resizeZoneRect(RECT, "se", 10, 5)).toEqual({
      xPct: 20,
      yPct: 30,
      widthPct: 50,
      heightPct: 30,
    });
  });

  it("moves the opposite corner when the north-west corner is dragged", () => {
    expect(resizeZoneRect(RECT, "nw", 5, 10)).toEqual({
      xPct: 25,
      yPct: 40,
      widthPct: 35,
      heightPct: 15,
    });
  });

  it("keeps the box inside the slide", () => {
    const grown = resizeZoneRect(RECT, "se", 500, 500);
    expect(grown.xPct + grown.widthPct).toBeLessThanOrEqual(100);
    expect(grown.yPct + grown.heightPct).toBeLessThanOrEqual(100);
  });

  it("keeps a minimum size when a corner is dragged past the opposite one", () => {
    const shrunk = resizeZoneRect(RECT, "nw", 100, 100);
    expect(shrunk.widthPct).toBeGreaterThanOrEqual(1);
    expect(shrunk.heightPct).toBeGreaterThanOrEqual(1);
  });

  it("never leaves the slide when the north-west corner is dragged out", () => {
    const pulled = resizeZoneRect(RECT, "nw", -80, -80);
    expect(pulled.xPct).toBeGreaterThanOrEqual(0);
    expect(pulled.yPct).toBeGreaterThanOrEqual(0);
  });
});
