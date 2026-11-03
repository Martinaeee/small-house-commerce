import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { qianyiCarrier, qianyiEventKey, qianyiEventTime } from './qianyi-event.js';

describe('qianyiEventKey', () => {
  const base = {
    orderNumber: 'S1', onlineOrderNumber: 'PH1', trackingNumber: 'T1',
    status: 'IN_TRANSIT', province: 'Davao', city: 'Davao City', eventTime: '2026-10-29T11:00:00+08:00',
  };

  it('treats the same status at the same place and time as one event', () => {
    expect(qianyiEventKey('PUSH_TRACKING_PACKAGE', base))
      .toBe(qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base }));
  });

  it('separates nodes that differ only by place', () => {
    expect(qianyiEventKey('PUSH_TRACKING_PACKAGE', base))
      .not.toBe(qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base, city: 'Manila' }));
  });

  it('separates nodes that differ only by the time they happened', () => {
    expect(qianyiEventKey('PUSH_TRACKING_PACKAGE', base))
      .not.toBe(qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base, eventTime: '2026-10-29T12:00:00+08:00' }));
  });

  it('separates two parcels of the same order', () => {
    expect(qianyiEventKey('PUSH_ODO_ORDER', base))
      .not.toBe(qianyiEventKey('PUSH_ODO_ORDER', { ...base, trackingNumber: 'T2' }));
  });

  it('uses a vendor event id when one is supplied', () => {
    const key = qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base, eventId: 'scan-1' });
    expect(key).toBe(qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base, eventId: 'scan-1', city: 'Changed' }));
    expect(key).not.toBe(qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base, eventId: 'scan-2' }));
  });

  it('quotes separators inside values so the tuple cannot be confused', () => {
    expect(qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base, city: 'A|B' }))
      .not.toBe(qianyiEventKey('PUSH_TRACKING_PACKAGE', { ...base, city: 'A', province: 'B' }));
  });
});

describe('qianyiEventTime', () => {
  it('accepts epoch milliseconds and documented date strings', () => {
    expect(qianyiEventTime({ shippingTime: 1700000000000 })?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(qianyiEventTime({ eventTime: '2026-10-29T11:00:00+08:00' })?.toISOString()).toBe('2026-10-29T03:00:00.000Z');
  });

  it('rejects an unreadable time instead of silently using now', () => {
    expect(() => qianyiEventTime({ eventTime: 'not-a-time' })).toThrow(BadRequestException);
  });
});

describe('qianyiCarrier', () => {
  it('keeps a real carrier over the placeholder from an older callback', () => {
    expect(qianyiCarrier('J&T Express', 'SHIPDOC')).toBe('J&T Express');
    expect(qianyiCarrier('J&T Express', '')).toBe('J&T Express');
  });

  it('adopts a real carrier over a placeholder or an empty value', () => {
    expect(qianyiCarrier('SHIPDOC', 'J&T Express')).toBe('J&T Express');
    expect(qianyiCarrier(null, 'J&T Express')).toBe('J&T Express');
  });

  it('falls back to the placeholder only when nothing real is known', () => {
    expect(qianyiCarrier(null, undefined)).toBe('SHIPDOC');
    expect(qianyiCarrier('SHIPDOC', 'SHIPDOC-STD')).toBe('SHIPDOC');
  });
});
