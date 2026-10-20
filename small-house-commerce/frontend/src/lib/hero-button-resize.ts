/**
 * Direct-manipulation resize math for hero CTA buttons.
 *
 * Pointer deltas arrive here already converted from screen pixels to the
 * simulated device's CSS pixels (the canvas divides by its zoom/scale). Edge
 * handles change a single axis; corner handles scale the whole button —
 * width, height, font size and paddings move together by one factor so the
 * label, arrow and spacing shrink/grow with the frame instead of clipping.
 */

export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface ButtonResizeStart {
  width: number;
  height: number;
  fontSize: number;
  paddingX: number;
  paddingY: number;
}

export interface ButtonResizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  minFontSize: number;
  maxFontSize: number;
  /** Upper bound for a corner-scaled padding value. Defaults to 120. */
  maxPadding?: number;
}

export interface ButtonResizeInput {
  direction: ResizeDirection;
  start: ButtonResizeStart;
  limits: ButtonResizeLimits;
  /** Horizontal pointer delta in CSS px (positive = right). */
  dx: number;
  /** Vertical pointer delta in CSS px (positive = down). */
  dy: number;
}

export interface ButtonResizeResult {
  width: number;
  height: number;
  fontSize: number;
  paddingX: number;
  paddingY: number;
  /** True when the drag scaled type and spacing (corner handles). */
  scaledType: boolean;
  /** True when a limit stopped the pointer from reaching the requested size. */
  clamped: boolean;
}

const DEFAULT_MAX_PADDING = 120;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function computeButtonResize({
  direction,
  start,
  limits,
  dx,
  dy,
}: ButtonResizeInput): ButtonResizeResult {
  const safeDx = finite(dx, 0);
  const safeDy = finite(dy, 0);
  const startWidth = Math.max(0, finite(start.width, 0));
  const startHeight = Math.max(0, finite(start.height, 0));
  const startFont = Math.max(0, finite(start.fontSize, 0));
  const startPaddingX = Math.max(0, finite(start.paddingX, 0));
  const startPaddingY = Math.max(0, finite(start.paddingY, 0));

  const horizontal = direction.includes("e") || direction.includes("w");
  const vertical = direction.includes("n") || direction.includes("s");
  const widthDelta = direction.includes("e")
    ? safeDx
    : direction.includes("w")
      ? -safeDx
      : 0;
  const heightDelta = direction.includes("s")
    ? safeDy
    : direction.includes("n")
      ? -safeDy
      : 0;

  const minWidth = Math.max(0, finite(limits.minWidth, 0));
  const minHeight = Math.max(0, finite(limits.minHeight, 0));
  const maxWidth = Math.max(minWidth, finite(limits.maxWidth, minWidth));
  const maxHeight = Math.max(minHeight, finite(limits.maxHeight, minHeight));
  const minFont = Math.max(0.1, finite(limits.minFontSize, 0.1));
  const maxFont = Math.max(minFont, finite(limits.maxFontSize, minFont));
  const maxPadding = Math.max(
    0,
    finite(limits.maxPadding ?? DEFAULT_MAX_PADDING, DEFAULT_MAX_PADDING),
  );

  if (horizontal && vertical) {
    const safeWidth = Math.max(startWidth, 1);
    const safeHeight = Math.max(startHeight, 1);
    const safeFont = Math.max(startFont, 0.1);
    const requested = Math.max(
      (startWidth + widthDelta) / safeWidth,
      (startHeight + heightDelta) / safeHeight,
    );
    const fontFloor = minFont / safeFont;
    const paddingFloor = 0;
    const factorFloor = Math.max(minWidth / safeWidth, minHeight / safeHeight, fontFloor, paddingFloor);
    const paddingCeiling = Math.min(
      startPaddingX > 0 ? maxPadding / startPaddingX : Number.POSITIVE_INFINITY,
      startPaddingY > 0 ? maxPadding / startPaddingY : Number.POSITIVE_INFINITY,
    );
    const factorCeiling = Math.max(
      factorFloor,
      Math.min(
        maxWidth / safeWidth,
        maxHeight / safeHeight,
        maxFont / safeFont,
        paddingCeiling,
      ),
    );
    const factor = clamp(requested, factorFloor, factorCeiling);
    const width = clamp(Math.round(startWidth * factor), minWidth, maxWidth);
    const height = clamp(Math.round(startHeight * factor), minHeight, maxHeight);
    return {
      width,
      height,
      fontSize: round1(clamp(startFont * factor, minFont, maxFont)),
      paddingX: round1(clamp(startPaddingX * factor, 0, maxPadding)),
      paddingY: round1(clamp(startPaddingY * factor, 0, maxPadding)),
      scaledType: true,
      clamped: Math.abs(factor - requested) > 0.0001,
    };
  }

  if (horizontal) {
    const requested = startWidth + widthDelta;
    const width = clamp(Math.round(requested), minWidth, maxWidth);
    return {
      width,
      height: startHeight,
      fontSize: startFont,
      paddingX: startPaddingX,
      paddingY: startPaddingY,
      scaledType: false,
      clamped: Math.abs(width - requested) > 0.5,
    };
  }

  if (vertical) {
    const requested = startHeight + heightDelta;
    const height = clamp(Math.round(requested), minHeight, maxHeight);
    return {
      width: startWidth,
      height,
      fontSize: startFont,
      paddingX: startPaddingX,
      paddingY: startPaddingY,
      scaledType: false,
      clamped: Math.abs(height - requested) > 0.5,
    };
  }

  return {
    width: startWidth,
    height: startHeight,
    fontSize: startFont,
    paddingX: startPaddingX,
    paddingY: startPaddingY,
    scaledType: false,
    clamped: false,
  };
}
