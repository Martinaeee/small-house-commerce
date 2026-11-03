import { describe, expect, it } from 'vitest';
import { manilaToday } from './marketing-post-date';
describe('manilaToday', () => {
  it('uses Manila day across UTC boundaries', () => {
    expect(manilaToday(new Date('2026-11-02T16:00:00Z'))).toBe('2026-11-03');
    expect(manilaToday(new Date('2026-11-03T15:59:59Z'))).toBe('2026-11-03');
    expect(manilaToday(new Date('2026-11-03T16:00:00Z'))).toBe('2026-11-04');
  });
});
