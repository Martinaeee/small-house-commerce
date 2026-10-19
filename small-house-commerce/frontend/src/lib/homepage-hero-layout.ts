import type { HeroElementKey, HomepageDevice } from "./homepage-document";

export type HeroBox = {
  key: HeroElementKey;
  left: number;
  top: number;
  width: number;
  height: number;
};
export type HeroHeightInput = {
  mode: "SCREEN" | "BANNER" | "NATURAL";
  device: HomepageDevice;
  width: number;
  viewportHeight: number;
  shellTop: number;
  shellBottom: number;
  mediaRatio: number | null;
};

export function heroTargetHeight(input: HeroHeightInput): number {
  const available = Math.max(0, input.viewportHeight - input.shellTop - input.shellBottom);
  if (input.mode === "SCREEN") return available;
  if (input.mode === "NATURAL") {
    if (input.mediaRatio !== null && Number.isFinite(input.mediaRatio) && input.mediaRatio > 0) {
      return input.width / input.mediaRatio;
    }
    return input.device === "desktop"
      ? Math.min(720, Math.max(560, input.viewportHeight * 0.72))
      : input.width * 1.25;
  }
  const range = input.device === "desktop" ? [420, .62, 640]
    : input.device === "tablet" ? [400, .64, 600] : [360, .62, 500];
  return Math.min(range[2], Math.max(range[0], available * range[1]));
}

export function flowHeroBoxes(
  boxes: HeroBox[],
  bounds: { width: number; height: number; padding: number; device: HomepageDevice },
): { height: number; boxes: HeroBox[] } {
  const placed: HeroBox[] = [];
  const width = Math.max(0, bounds.width - bounds.padding * 2);
  let bottom = 0;
  for (const source of boxes) {
    const previous = placed.at(-1);
    const action = source.key.startsWith("cta");
    const paired = action && previous?.key === "ctaPrimary" && source.key === "ctaSecondary";
    const sameRow = paired && previous.width + source.width + 12 <= width;
    const gap = !previous ? 0 : paired ? 12 : action ? bounds.device === "desktop" ? 24 : 20
      : bounds.device === "desktop" ? 16 : bounds.device === "tablet" ? 14 : 12;
    const top = sameRow ? previous.top : bottom + gap;
    const box = { ...source, left: sameRow ? previous.left + previous.width + 12 : bounds.padding,
      top, width: Math.min(source.width, width) };
    placed.push(box);
    bottom = Math.max(bottom, top + box.height);
  }
  const height = Math.max(bounds.height, bottom + bounds.padding * 2);
  const offset = Math.max(bounds.padding, (height - bottom) / 2);
  return { height, boxes: placed.map((box) => ({ ...box, top: box.top + offset })) };
}

export function fitHeroBoxes(
  boxes: HeroBox[],
  bounds: { width: number; height: number; padding: number; gap: number },
): { height: number; boxes: HeroBox[] } {
  const padding = Math.min(bounds.padding, bounds.width / 2);
  const placed: HeroBox[] = [];
  for (const source of [...boxes].sort((a, b) => a.top - b.top)) {
    const width = Math.max(0, Math.min(source.width, bounds.width - padding * 2));
    const box = { ...source, width,
      left: Math.max(padding, Math.min(source.left, bounds.width - padding - width)),
      top: Math.max(padding, source.top),
    };
    let collision: HeroBox | undefined;
    while ((collision = placed.find((previous) =>
      box.left < previous.left + previous.width && box.left + box.width > previous.left &&
      box.top < previous.top + previous.height + bounds.gap && box.top + box.height + bounds.gap > previous.top,
    ))) {
      box.top = collision.top + collision.height + bounds.gap;
    }
    placed.push(box);
  }
  return { boxes: placed, height: Math.max(bounds.height, ...placed.map((box) => box.top + box.height + padding)) };
}
