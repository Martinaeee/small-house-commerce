import { describe, expect, it } from 'vitest';
import { normalizePhilippinePhone } from './phone.util.js';

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
