import { describe, expect, it } from 'vitest';
import { assertFaqE2ETestTarget } from './e2e-faq-test-target.js';

describe('assertFaqE2ETestTarget', () => {
  it('accepts only the exact disposable FAQ database on loopback', () => {
    expect(
      assertFaqE2ETestTarget(
        'postgresql://postgres:postgres@localhost:5432/small_house_variant_test?schema=public',
      ),
    ).toEqual({
      database: 'small_house_variant_test',
      host: 'localhost',
      port: '5432',
    });
  });

  it.each([
    [undefined, 'DATABASE_URL is required'],
    ['not-a-url', 'parseable PostgreSQL URL'],
    ['mysql://localhost:5432/small_house_variant_test', 'protocol'],
    ['postgresql://db.internal:5432/small_house_variant_test', 'loopback'],
    ['postgresql://localhost:6432/small_house_variant_test', 'port'],
    ['postgresql://localhost:5432/small_house', 'database'],
  ])('rejects an unsafe target %#', (databaseUrl, message) => {
    expect(() => assertFaqE2ETestTarget(databaseUrl)).toThrow(message);
  });

  it('allows an explicitly configured loopback port', () => {
    expect(
      assertFaqE2ETestTarget(
        'postgres://127.0.0.1:5544/small_house_variant_test',
        '5544',
      ),
    ).toMatchObject({ host: '127.0.0.1', port: '5544' });
  });
});
