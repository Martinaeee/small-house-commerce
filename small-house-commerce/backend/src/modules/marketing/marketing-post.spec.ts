import { describe, expect, it } from 'vitest';
import { autoPostName, isFacebookPostUrl, postDateFromDb, postDateToDb } from './marketing-post.js';

describe('marketing post metadata', () => {
  it('accepts only https Facebook post hosts', () => {
    for (const value of [
      'https://www.facebook.com/luwag/posts/123',
      'https://facebook.com/luwag/posts/123',
      'https://fb.watch/abc123/',
    ]) expect(isFacebookPostUrl(value)).toBe(true);
    for (const value of [
      'http://www.facebook.com/luwag/posts/123',
      'https://facebook.com.example.com/luwag/posts/123',
      'https://user:pass@facebook.com/luwag/posts/123',
      'https://notfacebook.com/luwag/posts/123',
      'javascript:alert(1)',
    ]) expect(isFacebookPostUrl(value)).toBe(false);
  });

  it('round-trips a calendar date without shifting it through a timezone', () => {
    expect(postDateToDb('2026-11-03').toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(postDateFromDb(postDateToDb('2026-11-03'))).toBe('2026-11-03');
    expect(postDateFromDb(null)).toBeNull();
  });

  it('auto-names with the date, product and a short link discriminator under 120 characters', () => {
    const name = autoPostName('2026-11-03', 'Expandable Transparent Shoe Cabinet', 'AbCdEfGhIjKlMnOp');
    expect(name).toBe('11-03｜Expandable Transparent Shoe Cabinet｜帖子 KlMnOp');
    expect(name.length).toBeLessThanOrEqual(120);
    expect(autoPostName('2026-11-03', 'X'.repeat(300), 'AbCdEfGhIjKlMnOp').length).toBe(120);
  });
});
