import { describe, expect, it } from 'vitest';
import { normaliseAid } from './marketing-attribution.js';

describe('normaliseAid', () => {
  it('trims and upper-cases a well-formed AID', () => {
    expect(normaliseAid(' ma-1 ')).toBe('MA-1');
  });

  it('accepts dots, underscores and dashes after the first character', () => {
    expect(normaliseAid('opt_a.1-b')).toBe('OPT_A.1-B');
  });

  it('rejects values containing whitespace or other separators', () => {
    expect(normaliseAid('MA 1')).toBeNull();
    expect(normaliseAid('MA/1')).toBeNull();
    expect(normaliseAid('MA#1')).toBeNull();
  });

  it('rejects empty, leading-punctuation and over-long values', () => {
    expect(normaliseAid('')).toBeNull();
    expect(normaliseAid('   ')).toBeNull();
    expect(normaliseAid(null)).toBeNull();
    expect(normaliseAid(undefined)).toBeNull();
    expect(normaliseAid('-MA1')).toBeNull();
    expect(normaliseAid('a'.repeat(65))).toBeNull();
  });

  it('accepts a value at the 64 character limit', () => {
    expect(normaliseAid('a'.repeat(64))).toBe('A'.repeat(64));
  });
});
