"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function padUnit(value: number): string {
  return String(value).padStart(2, "0");
}

function partsFrom(milliseconds: number): CountdownParts {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function CountdownDisplay({
  parts,
  style,
  align,
}: {
  parts: CountdownParts;
  style?: CSSProperties;
  align?: string;
}): ReactNode {
  return (
    <span
      data-hero-countdown
      data-testid="hero-countdown"
      role="timer"
      aria-live="polite"
      className="inline-flex items-baseline gap-1 font-semibold tabular-nums"
      style={align ? { textAlign: align as never, ...style } : style}
    >
      <span data-countdown-unit="d">{padUnit(parts.days)}</span>
      <span className="opacity-60" aria-hidden="true">
        :
      </span>
      <span data-countdown-unit="h">{padUnit(parts.hours)}</span>
      <span className="opacity-60" aria-hidden="true">
        :
      </span>
      <span data-countdown-unit="m">{padUnit(parts.minutes)}</span>
      <span className="opacity-60" aria-hidden="true">
        :
      </span>
      <span data-countdown-unit="s">{padUnit(parts.seconds)}</span>
    </span>
  );
}

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
  if (ended) {
    return (
      <CountdownDisplay
        parts={{ days: 0, hours: 0, minutes: 0, seconds: 0 }}
        style={style}
        align={align}
      />
    );
  }

  const remaining = ends - now;
  return (
    <CountdownDisplay parts={partsFrom(remaining)} style={style} align={align} />
  );
}