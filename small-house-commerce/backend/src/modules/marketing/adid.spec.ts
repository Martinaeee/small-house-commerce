import { describe, expect, it } from 'vitest';
import { adidFor, calendarDayKey, manilaDayKey } from './adid.js';

describe('adid day keys', () => {
  it('reads the Manila calendar day from an instant', () => {
    expect(manilaDayKey(new Date('2026-11-04T16:30:00.000Z'))).toBe('261105');
    expect(manilaDayKey(new Date('2026-11-04T15:30:00.000Z'))).toBe('261104');
  });

  it('reads a stored post date as the calendar date it was entered as', () => {
    expect(calendarDayKey(new Date('2026-11-05T00:00:00.000Z'))).toBe('261105');
  });
});

describe('adid formatting', () => {
  it('puts the optimizer, day and a two-digit sequence in the number', () => {
    expect(adidFor('FB', 'OP-1', '261105', 2)).toBe('FB-OP-1-261105-02');
    expect(adidFor('AD', 'OP-1', '261105', 12)).toBe('AD-OP-1-261105-12');
  });

  it('lets the sequence grow past two digits instead of wrapping', () => {
    expect(adidFor('FB', 'OP-1', '261105', 100)).toBe('FB-OP-1-261105-100');
  });
});
