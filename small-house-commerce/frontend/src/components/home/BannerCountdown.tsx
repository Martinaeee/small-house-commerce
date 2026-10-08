"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Shared countdown primitives for the HERO slide countdown and the
 * COUNTDOWN_BANNER section. Pure math and presentational markup live here;
 * each wrapper owns its own visibility semantics.
 */

export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export function padUnit(value: number): string {
  return String(value).padStart(2, "0");
}

export function countdownPartsFrom(milliseconds: number): CountdownParts {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

/**
 * Presentational dd:hh:mm:ss cells. No role/aria: the wrapper decides whether
 * the clock announces (`role="timer"`, optional `aria-live`).
 */
export function CountdownDigits({
  parts,
  className = "",
}: {
  parts: CountdownParts;
  className?: string;
}): ReactNode {
  return (
    <span
      className={`inline-flex items-baseline gap-1 font-semibold tabular-nums ${className}`.trim()}
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
 * Deadline-driven visibility for banner sections.
 *
 * - `deadlineMs` is an absolute epoch time; `NaN`/`Infinity` means "no
 *   deadline". The window is half-open: `now < deadline` is active, so a
 *   countdown disappears at (never before) its deadline.
 * - `hideUntilMounted` keeps the server HTML and the first client render
 *   identical for time-dependent content: nothing renders until an effect
 *   reads the real clock. Set it for the countdown banner, whose digits would
 *   otherwise mismatch during hydration.
 * - `requireDeadline` makes a missing/invalid deadline hide the section
 *   (countdown fail-closed); without it a missing deadline simply means
 *   "always visible" (promo).
 *
 * The clock re-reads `Date.now()` every second and schedules an extra tick
 * exactly at the deadline, so non-whole-second deadlines hide on time instead
 * of waiting for the next second tick. All timers are cleaned up on unmount,
 * deadline change, or once the deadline has passed.
 */
export function useDeadlineCountdown(
  deadlineMs: number,
  {
    hideUntilMounted,
    requireDeadline,
  }: { hideUntilMounted: boolean; requireDeadline: boolean },
): { active: boolean; parts: CountdownParts | null } {
  const [state, setState] = useState<{ mounted: boolean; now: number }>({
    mounted: false,
    now: 0,
  });

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const nowMs = Date.now();
      setState({ mounted: true, now: nowMs });
      if (Number.isFinite(deadlineMs) && nowMs >= deadlineMs) {
        if (interval !== undefined) clearInterval(interval);
        if (timeout !== undefined) clearTimeout(timeout);
      }
    };

    tick();
    if (Number.isFinite(deadlineMs)) {
      interval = setInterval(tick, 1000);
      const untilDeadline = deadlineMs - Date.now();
      if (untilDeadline > 0) timeout = setTimeout(tick, untilDeadline + 1);
    }
    // A backgrounded tab throttles intervals; re-check when it becomes visible.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (interval !== undefined) clearInterval(interval);
      if (timeout !== undefined) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [deadlineMs]);

  const hasDeadline = Number.isFinite(deadlineMs);
  const active = !hasDeadline
    ? !requireDeadline
    : state.mounted
      ? state.now < deadlineMs
      : !hideUntilMounted;
  const parts =
    active && hasDeadline && state.mounted
      ? countdownPartsFrom(deadlineMs - state.now)
      : null;

  return { active, parts };
}
