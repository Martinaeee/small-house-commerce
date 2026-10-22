/**
 * Dashboard formatting helpers.
 *
 * The dashboard API already rounds money to 2 dp and sends numbers (not
 * Decimal strings), so these functions only handle presentation. All times
 * are rendered in Asia/Manila because that is the day the operators operate in.
 */

const moneyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const moneyFormatterPrecise = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const countFormatter = new Intl.NumberFormat("en-PH");

export function money(value: number | null | undefined, precise = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return precise ? moneyFormatterPrecise.format(value) : moneyFormatter.format(value);
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return countFormatter.format(value);
}

/** Ratio (0-1) to a percentage string; null renders as an em dash. */
export function ratio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
});

export function manilaDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

export function manilaDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

/** Relative "in 1d 6h" label used by campaign and schedule rows. */
export function untilLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const delta = target - now.getTime();
  if (delta <= 0) return null;
  const days = Math.floor(delta / 86_400_000);
  const hours = Math.floor((delta % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((delta % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

/** Manila calendar date `YYYY-MM-DD` for the date inputs. */
export function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}
