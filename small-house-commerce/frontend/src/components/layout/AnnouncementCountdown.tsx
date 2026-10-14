import type { CSSProperties, ReactElement } from "react";

import type { AnnouncementCountdownConfig } from "@/lib/homepage-document";
import { safeHex } from "@/lib/homepage-styles";

export type AnnouncementDevice = "desktop" | "tablet" | "mobile";

type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const FONT_SIZE: Record<AnnouncementCountdownConfig["fontSize"], string> = {
  SM: "12px",
  MD: "14px",
  LG: "16px",
};

function countdownParts(endsAt: string, nowMs: number): CountdownParts | null {
  const deadline = Date.parse(endsAt);
  if (!Number.isFinite(deadline) || deadline <= nowMs) return null;
  let seconds = Math.ceil((deadline - nowMs) / 1000);
  const days = Math.floor(seconds / 86_400);
  seconds -= days * 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds -= hours * 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  return { days, hours, minutes, seconds };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatAnnouncementCountdown(
  endsAt: string,
  nowMs: number,
  compact: boolean,
): string | null {
  const parts = countdownParts(endsAt, nowMs);
  if (parts === null) return null;
  if (compact) {
    return `${parts.days}D ${twoDigits(parts.hours)}H ${twoDigits(parts.minutes)}M ${twoDigits(parts.seconds)}S`;
  }
  const dayUnit = parts.days === 1 ? "DAY" : "DAYS";
  return `${parts.days} ${dayUnit} ${twoDigits(parts.hours)} HR ${twoDigits(parts.minutes)} MIN ${twoDigits(parts.seconds)} SEC`;
}

export function AnnouncementCountdown({
  config,
  nowMs,
  device,
}: {
  config: AnnouncementCountdownConfig;
  nowMs: number | null;
  device: AnnouncementDevice;
}): ReactElement | null {
  if (config.endsAt === null || nowMs === null) return null;
  const text = formatAnnouncementCountdown(
    config.endsAt,
    nowMs,
    device === "mobile",
  );
  if (text === null) return null;

  const style: CSSProperties = {
    fontSize: FONT_SIZE[config.fontSize],
    fontWeight: config.fontWeight,
    fontFamily:
      config.fontFamily === "POPPINS"
        ? "var(--font-poppins), var(--font-sans)"
        : "var(--font-sans)",
  };
  if (config.color !== null) style.color = safeHex(config.color, "#FFFFFF");

  return (
    <span
      role="timer"
      aria-live="off"
      aria-label={`Offer ends ${config.endsAt}`}
      className="whitespace-nowrap tabular-nums"
      style={style}
    >
      {text}
    </span>
  );
}
