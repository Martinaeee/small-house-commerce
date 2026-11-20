import { randomInt } from 'node:crypto';

/**
 * SUNRATE stamps every request with the merchant's local wall clock in
 * `yyyyMMddHHmmss` form. The merchant order number carries the same shape,
 * so an order number is readable as a timestamp and lines up with the
 * gateway's own transTime.
 */
export const manilaTransTime = (date: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${pick('year')}${pick('month')}${pick('day')}${pick('hour')}${pick('minute')}${pick('second')}`;
};

/**
 * The order number handed to SUNRATE: 'AT' + Manila timestamp + 6 random
 * digits. It is unique per merchant and never reused — the gateway echoes it
 * on every notification and on every query, so it is the handle we reconcile
 * a payment against.
 */
export const newMerchantOrderNum = (date: Date = new Date()): string =>
  `AT${manilaTransTime(date)}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
