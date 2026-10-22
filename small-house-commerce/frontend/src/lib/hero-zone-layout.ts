/**
 * The geometry of a hero link zone.
 *
 * A zone is a rectangle in the slide's percentage space, so it keeps its
 * place on every device. Two gestures shape it: a drag paints a new box, and
 * a corner drag re-shapes a box that already exists. Both helpers stay pure
 * so the canvas, the panel and the tests agree on the numbers.
 */

export type ZoneRect = {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
};

/** The corner a resize handle drags. */
export type ZoneCorner = "nw" | "ne" | "sw" | "se";

/** A zone never collapses below this, so it stays grabbable. */
const MIN_ZONE_PCT = 1;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** The box a drag from `start` to `end` paints. */
export function zoneRectFromDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): ZoneRect {
  const xPct = Math.min(startX, endX);
  const yPct = Math.min(startY, endY);
  return {
    xPct: clamp(xPct, 0, 100),
    yPct: clamp(yPct, 0, 100),
    widthPct: clamp(Math.abs(endX - startX), 0, 100 - xPct),
    heightPct: clamp(Math.abs(endY - startY), 0, 100 - yPct),
  };
}

/**
 * The box after a corner handle moved by `dxPct`/`dyPct` (a drag to the
 * right is positive). The opposite corner stays put, the dragged corner
 * follows, and the result is clamped to the slide.
 */
export function resizeZoneRect(
  rect: ZoneRect,
  corner: ZoneCorner,
  dxPct: number,
  dyPct: number,
): ZoneRect {
  const dx = Number.isFinite(dxPct) ? dxPct : 0;
  const dy = Number.isFinite(dyPct) ? dyPct : 0;

  let xPct = rect.xPct;
  let yPct = rect.yPct;
  let widthPct = rect.widthPct;
  let heightPct = rect.heightPct;

  if (corner === "se") {
    widthPct = rect.widthPct + dx;
    heightPct = rect.heightPct + dy;
  } else if (corner === "nw") {
    xPct = rect.xPct + dx;
    yPct = rect.yPct + dy;
    widthPct = rect.widthPct - dx;
    heightPct = rect.heightPct - dy;
  } else if (corner === "ne") {
    yPct = rect.yPct + dy;
    widthPct = rect.widthPct + dx;
    heightPct = rect.heightPct - dy;
  } else {
    xPct = rect.xPct + dx;
    widthPct = rect.widthPct - dx;
    heightPct = rect.heightPct + dy;
  }

  // A corner dragged past its opposite keeps the box at the minimum size
  // instead of turning inside out.
  if (widthPct < MIN_ZONE_PCT) {
    if (corner === "nw" || corner === "sw") xPct = rect.xPct + rect.widthPct - MIN_ZONE_PCT;
    widthPct = MIN_ZONE_PCT;
  }
  if (heightPct < MIN_ZONE_PCT) {
    if (corner === "nw" || corner === "ne") yPct = rect.yPct + rect.heightPct - MIN_ZONE_PCT;
    heightPct = MIN_ZONE_PCT;
  }

  xPct = clamp(xPct, 0, 100 - MIN_ZONE_PCT);
  yPct = clamp(yPct, 0, 100 - MIN_ZONE_PCT);
  widthPct = clamp(widthPct, MIN_ZONE_PCT, 100 - xPct);
  heightPct = clamp(heightPct, MIN_ZONE_PCT, 100 - yPct);

  return { xPct, yPct, widthPct, heightPct };
}
