import { describe, expect, it } from 'vitest';
import { adminSearchQuerySchema } from './search.dto.js';

describe('adminSearchQuerySchema', () => {
  it('normalizes whitespace and defaults limit to five', () => {
    expect(adminSearchQuerySchema.parse({ q: '  rolling   cart  ' })).toEqual({
      q: 'rolling cart',
      limit: 5,
    });
  });

  it.each(['', ' ', 'a', '🪑'])(
    'rejects queries shorter than two Unicode characters: %j',
    (q) => {
      expect(adminSearchQuerySchema.safeParse({ q }).success).toBe(false);
    },
  );

  it('counts Unicode code points consistently with the client', () => {
    expect(adminSearchQuerySchema.parse({ q: '🪑桌' }).q).toBe('🪑桌');
  });

  it('rejects a query over 100 characters and a limit over 20', () => {
    expect(adminSearchQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(adminSearchQuerySchema.safeParse({ q: 'chair', limit: 21 }).success).toBe(false);
  });
});
