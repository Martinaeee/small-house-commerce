import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export function qianyiField(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export function qianyiEventTime(payload: Record<string, unknown>): Date | null {
  const raw = qianyiField(payload, 'eventTime', 'shippingTime', 'finishedTime');
  if (!raw) return null;
  const date = new Date(/^\d+$/.test(raw) ? Number(raw) : raw);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('Invalid Qianyi event time');
  return date;
}

export function qianyiEventKey(serviceType: string, payload: Record<string, unknown>): string {
  const order = qianyiField(payload, 'onlineOrderNumber', 'onlineOrderId', 'orderNumber');
  const tracking = qianyiField(payload, 'trackingNumber', 'trackNumber');
  const id = qianyiField(payload, 'eventId', 'eventID', 'externalEventId');
  const identity = id
    ? [serviceType, order, tracking, 'id', id]
    : [serviceType, order, qianyiField(payload, 'orderNumber'), tracking,
      qianyiField(payload, 'status', 'erpStatus'), qianyiEventTime(payload)?.toISOString() ?? '',
      qianyiField(payload, 'province'), qianyiField(payload, 'city'),
      qianyiField(payload, 'location'), qianyiField(payload, 'warehouseName')];
  return `${serviceType}:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export function qianyiCarrier(current: string | null | undefined, incoming: unknown): string {
  const real = (value: string) => value && !['SHIPDOC', 'SHIPDOC-STD'].includes(value.toUpperCase());
  const stored = current?.trim() ?? '';
  const candidate = typeof incoming === 'string' ? incoming.trim().slice(0, 100) : '';
  return real(stored) ? stored : real(candidate) ? candidate : stored || 'SHIPDOC';
}
