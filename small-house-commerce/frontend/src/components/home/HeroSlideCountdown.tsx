"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CountdownDigits,
  countdownPartsFrom,
} from "./BannerCountdown";

/**
 * Live client countdown for a HERO slide offer (plan Task 19).
 *
 * - `endsAt` null or already past at mount -> renders nothing.
 * - A live countdown ticks every second and freezes at zero once reached (the
 *   interval is cleared, so the element stops updating).
 *
 * `style` is passed through to the root; `layout` currently only contributes a
 * text alignment override.
 */
export function HeroSlideCountdown({
  endsAt,
  style,
  layout,
}: {
  endsAt: string | null;
  style?: CSSProperties;
  layout?: { textAlign?: string } | null;
}): ReactNode | null {
  const ends = useMemo(() => {
    if (!endsAt) return null;
    const time = new Date(endsAt).getTime();
    return Number.isFinite(time) ? time : null;
  }, [endsAt]);

  const [now, setNow] = useState<number>(() => Date.now());

  // First-render fact, kept across renders: whether the window had already
  // closed when this instance mounted. An endsAt that is past from the very
  // first frame renders nothing; a window that expires *while mounted* is
  // allowed to reach its zero display and stop.
  const [startedExpired] = useState<boolean>(
    () => ends !== null && ends <= Date.now(),
  );
  const ended = ends !== null && now >= ends;

  useEffect(() => {
    if (ends === null || ended) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ends, ended]);

  if (ends === null || startedExpired) return null;

  const align = layout?.textAlign;
  const rootStyle = align
    ? ({ textAlign: align as never, ...style } satisfies CSSProperties)
    : style;

  if (ended) {
    return (
      <span
        data-hero-countdown
        data-testid="hero-countdown"
        role="timer"
        aria-live="polite"
        className="inline-flex items-baseline gap-1 font-semibold tabular-nums"
        style={rootStyle}
      >
        <CountdownDigits parts={{ days: 0, hours: 0, minutes: 0, seconds: 0 }} />
      </span>
    );
  }

  const remaining = ends - now;
  return (
    <span
      data-hero-countdown
      data-testid="hero-countdown"
      role="timer"
      aria-live="polite"
      className="inline-flex items-baseline gap-1 font-semibold tabular-nums"
      style={rootStyle}
    >
      <CountdownDigits parts={countdownPartsFrom(remaining)} />
    </span>
  );
}
