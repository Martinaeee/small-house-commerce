import { describe, expect, it } from 'vitest';
import { isAdminSource, hashMetaPhone } from './meta-user-data.js';
import { createHash } from 'node:crypto';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('hashMetaPhone', () => {
  it('hashes the E.164 digits of a local mobile number', () => {
    expect(hashMetaPhone('09171234567')).toBe(sha256('639171234567'));
  });

  it('normalizes +63 and grouped forms to the same hash', () => {
    const expected = sha256('639171234567');
    expect(hashMetaPhone('+639171234567')).toBe(expected);
    expect(hashMetaPhone('+63 917 123 4567')).toBe(expected);
  });

  it('refuses numbers that cannot be normalized', () => {
    expect(hashMetaPhone('12345')).toBeNull();
    expect(hashMetaPhone('not a phone')).toBeNull();
  });
});

describe('isAdminSource', () => {
  it('detects admin and preview pages', () => {
    expect(isAdminSource('https://luwag.shop/admin/orders')).toBe(true);
    expect(isAdminSource('https://luwag.shop/preview/homepage')).toBe(true);
    expect(isAdminSource('/admin/orders')).toBe(true);
    expect(isAdminSource('/preview/homepage')).toBe(true);
  });

  it('treats storefront pages as real traffic', () => {
    expect(isAdminSource('https://luwag.shop/checkout/confirm')).toBe(false);
    expect(isAdminSource('https://luwag.shop/products/oak-chair')).toBe(false);
    expect(isAdminSource(undefined)).toBe(false);
    expect(isAdminSource('/administrator-guide')).toBe(false);
  });
});
