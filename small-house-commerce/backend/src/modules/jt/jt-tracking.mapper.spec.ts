import { describe, expect, it } from 'vitest';
import { mapScanType, parseScanTime, toEventInput } from './jt-tracking.mapper.js';

const detail = (overrides: Record<string, unknown> = {}) => ({
  scanTime: '2026-05-09 09:57:32',
  desc: 'Your package has been Delivered',
  scanTypeName: 'Delivered',
  scanTypeCode: '113',
  staffConcatPhone: '9684746842',
  scanNetworkProvince: 'METRO-MANILA',
  scanNetworkCity: 'TAGUIG',
  sigPicUrl: 'https://example.test/sign.jpg',
  ...overrides,
});

describe('mapScanType', () => {
  it.each([
    ['106', 'SHIPPED'],
    ['109', 'IN_TRANSIT'],
    ['110', 'IN_TRANSIT'],
    ['112', 'OUT_FOR_DELIVERY'],
    ['113', 'SIGNED'],
    ['116', 'RETURNING'],
    ['117', 'RETURNED'],
    ['118', 'FAILED_DELIVERY'],
  ])('maps %s to %s', (code, expected) => {
    expect(mapScanType(code)).toBe(expected);
  });

  it('ignores codes it cannot classify', () => {
    expect(mapScanType('999')).toBeNull();
    expect(mapScanType('')).toBeNull();
  });
});

describe('parseScanTime', () => {
  it('reads the carrier timestamp as UTC+8, not as server-local time', () => {
    expect(parseScanTime('2026-05-09 09:57:32').toISOString()).toBe(
      '2026-05-09T01:57:32.000Z',
    );
  });
});

describe('toEventInput', () => {
  it('carries the carrier wording, rider phone and signature url', () => {
    const input = toEventInput(detail());
    expect(input).toEqual({
      normalizedStatus: 'SIGNED',
      externalEventId: '113:2026-05-09 09:57:32',
      externalStatus: 'Delivered',
      eventTime: new Date('2026-05-09T01:57:32.000Z'),
      province: 'METRO-MANILA',
      city: 'TAGUIG',
      description: 'Your package has been Delivered',
      staffContact: '9684746842',
      signatureImageUrl: 'https://example.test/sign.jpg',
    });
  });

  it('builds a stable id so a repeat poll is idempotent', () => {
    expect(toEventInput(detail())?.externalEventId).toBe(
      toEventInput(detail())?.externalEventId,
    );
  });

  it('returns null for an unmapped code', () => {
    expect(toEventInput(detail({ scanTypeCode: '999' }))).toBeNull();
  });
});
