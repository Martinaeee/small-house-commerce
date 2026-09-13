/**
 * PDP buy-box delivery estimates.
 *
 * Windows mirror the TrustBar copy exactly: Metro Manila 3–5 days,
 * provinces 5–7 days (calendar days from the order date). All calendar
 * math is rendered in Asia/Manila so an UTC server and a PH browser
 * produce the same string — the Philippines has no DST, so adding whole
 * days in ms is safe.
 */

const TIME_ZONE = "Asia/Manila";

type DayParts = { month: string; day: number };

function manilaDayParts(date: Date): DayParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
  }).formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "0");
  return { month, day };
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** "Sep 16–18" within one month; "Sep 28 – Oct 2" across a month boundary. */
export function formatDeliveryRange(now: Date, minDays: number, maxDays: number): string {
  const start = manilaDayParts(addDays(now, minDays));
  const end = manilaDayParts(addDays(now, maxDays));
  if (start.month === end.month) return `${start.month} ${start.day}–${end.day}`;
  return `${start.month} ${start.day} – ${end.month} ${end.day}`;
}

export interface DeliveryWindows {
  metro: string;
  provincial: string;
}

export function deliveryWindows(now: Date = new Date()): DeliveryWindows {
  return {
    metro: formatDeliveryRange(now, 3, 5),
    provincial: formatDeliveryRange(now, 5, 7),
  };
}
