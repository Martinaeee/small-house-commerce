/**
 * The formatting rules of the order workbench (the approved draft §A).
 *
 * They differ from the generic admin helpers on purpose:
 *   - money in a list is whole pesos ("₱1,598"); the exact amount with two
 *     decimals is reserved for the total of a summary block;
 *   - a table row shows a short time ("06-02 16:05") plus how long the order
 *     has been waiting, while the tables of one customer show the full time
 *     ("2026-06-02 16:05").
 */

/** ₱1,598 — cents only appear when the amount actually has them. */
export function peso(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return String(value);
  return `₱${amount.toLocaleString("en-US")}`;
}

/** ₱1,598.00 — the exact amount, for the total line of a summary block. */
export function pesoExact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return String(value);
  return `₱${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "06-02 16:05" — the time of a table row. */
export function shortDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return value ? String(value) : "—";
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** "2026-06-02 16:05" — the full time. */
export function fullDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return value ? String(value) : "—";
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** How many hours the order has been waiting. */
export function waitingHours(
  createdAt: string | Date | null | undefined,
  now: number = Date.now(),
): number {
  const date = toDate(createdAt);
  if (!date) return 0;
  return Math.max(0, (now - date.getTime()) / 3_600_000);
}

/** "141天 0小时" / "2小时 30分" — how long the order has been waiting. */
export function waitingAge(
  createdAt: string | Date | null | undefined,
  now: number = Date.now(),
): string {
  const hours = waitingHours(createdAt, now);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天 ${Math.round(hours % 24)}小时`;
  return `${Math.floor(hours)}小时 ${Math.round((hours % 1) * 60)}分`;
}

/**
 * The urgency of the waiting time: red after a day, amber after eight hours.
 * The colors are the admin semantic ones (error / warning / success).
 */
export function waitingTone(
  createdAt: string | Date | null | undefined,
  now: number = Date.now(),
): "bad" | "warn" | "ok" {
  const hours = waitingHours(createdAt, now);
  if (hours >= 24) return "bad";
  if (hours >= 8) return "warn";
  return "ok";
}

/** The color of a waiting time, as a class of the admin palette. */
export function waitingToneClass(tone: "bad" | "warn" | "ok"): string {
  if (tone === "bad") return "text-admin-error";
  if (tone === "warn") return "text-admin-warning";
  return "text-admin-success";
}
