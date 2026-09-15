/**
 * Helpers for <input type="datetime-local">: the control uses a wall-clock
 * value with NO zone ("YYYY-MM-DDTHH:mm"), while the API contract is an ISO
 * 8601 string. Conversion goes through the operator's local zone.
 */

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** ISO timestamp -> datetime-local value (minute precision, local zone). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

/** Date -> datetime-local value (minute precision, local zone). */
export function dateToLocalInput(d: Date): string {
  return isoToLocalInput(d.toISOString());
}

/** Current local time, for a datetime-local `max` attribute. */
export function nowLocalInput(): string {
  return dateToLocalInput(new Date());
}
