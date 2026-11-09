import { describe, expect, it } from 'vitest';
import {
  normalizeContactPhone,
  normalizePhilippinePhone,
  phoneSearchFragments,
} from './phone.util.js';

describe('normalizePhilippinePhone', () => {
  it('normalizes the three formats from DATABASE.md §12 to one identity', () => {
    expect(normalizePhilippinePhone('09171234567')).toBe('+639171234567');
    expect(normalizePhilippinePhone('+639171234567')).toBe('+639171234567');
    expect(normalizePhilippinePhone('639171234567')).toBe('+639171234567');
  });

  it('strips separators and spaces', () => {
    expect(normalizePhilippinePhone('0917 123 4567')).toBe('+639171234567');
    expect(normalizePhilippinePhone('+63 917-123-4567')).toBe('+639171234567');
    expect(normalizePhilippinePhone('(0917) 123-4567')).toBe('+639171234567');
  });

  it('rejects numbers that are not PH mobile length', () => {
    expect(normalizePhilippinePhone('12345')).toBeNull();
    expect(normalizePhilippinePhone('0917123456')).toBeNull();
    expect(normalizePhilippinePhone('+15123456789')).toBeNull();
    expect(normalizePhilippinePhone('')).toBeNull();
  });
});

describe('phoneSearchFragments', () => {
  it('turns a locally written prefix into the stored canonical prefix', () => {
    expect(phoneSearchFragments('09')).toEqual(['+639']);
    expect(phoneSearchFragments('224 466')).toEqual(['224466']);
    expect(phoneSearchFragments('0917')).toEqual(['+63917']);
    expect(phoneSearchFragments('0917 122')).toEqual(['+63917122']);
  });

  it('accepts the three ways an operator may write a full number', () => {
    expect(phoneSearchFragments('09171234567')).toEqual(['+639171234567']);
    expect(phoneSearchFragments('639171234567')).toEqual(['+639171234567']);
    expect(phoneSearchFragments('+639171234567')).toEqual(['+639171234567']);
  });

  it('understands a number typed without the leading zero', () => {
    expect(phoneSearchFragments('9171234567')).toEqual(['+639171234567']);
    expect(phoneSearchFragments('917')).toEqual(['+63917']);
  });

  it('ignores searches that are not phone numbers', () => {
    expect(phoneSearchFragments('PH100018')).toEqual([]);
    expect(phoneSearchFragments('0')).toEqual([]);
    expect(phoneSearchFragments('Marisol Reyes')).toEqual([]);
    expect(phoneSearchFragments('')).toEqual([]);
  });
});

describe('normalizeContactPhone', () => {
  it('keeps the canonical form for Philippine mobiles', () => {
    expect(normalizeContactPhone('09171234567')).toBe('+639171234567');
    expect(normalizeContactPhone('+63 917-123-4567')).toBe('+639171234567');
  });

  it('keeps other international numbers in a dialable form', () => {
    expect(normalizeContactPhone('+1 512 345 6789')).toBe('+15123456789');
  });

  it('drops anything that could never be dialled', () => {
    expect(normalizeContactPhone('')).toBeNull();
    expect(normalizeContactPhone('   ')).toBeNull();
    expect(normalizeContactPhone('12')).toBeNull();
    expect(normalizeContactPhone('not a number')).toBeNull();
    expect(normalizeContactPhone('1234567890123456789')).toBeNull();
    expect(normalizeContactPhone(null)).toBeNull();
    expect(normalizeContactPhone(undefined)).toBeNull();
  });
});
