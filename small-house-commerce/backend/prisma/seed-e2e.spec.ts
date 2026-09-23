import { describe, expect, it } from 'vitest';
import { testDatabaseGuard } from './seed-e2e.js';

/**
 * Task 20: the E2E seed refuses to touch anything that does not look like a
 * disposable test database. A typo'd DATABASE_URL must fail closed here, not
 * wipe a developer's local catalog or a production database.
 */
describe('seed-e2e test database guard', () => {
  it('accepts the documented variant test database', () => {
    const result = testDatabaseGuard(
      'postgresql://postgres:postgres@localhost:5432/small_house_variant_test?schema=public',
    );
    expect(result).toEqual({ ok: true, database: 'small_house_variant_test' });
  });

  it('accepts other explicitly test/e2e-suffixed databases', () => {
    expect(
      testDatabaseGuard('postgresql://postgres:postgres@localhost:5432/shop_test'),
    ).toMatchObject({ ok: true });
    expect(
      testDatabaseGuard('postgresql://postgres:postgres@localhost:5432/shop-e2e'),
    ).toMatchObject({ ok: true });
    expect(
      testDatabaseGuard('postgresql://postgres:postgres@localhost:5432/test_shop'),
    ).toMatchObject({ ok: true });
  });

  it('refuses the default development database', () => {
    const result = testDatabaseGuard(
      'postgresql://postgres:postgres@localhost:5432/small_house?schema=public',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('small_house');
      expect(result.reason).toContain('test');
    }
  });

  it('refuses production-looking database names', () => {
    for (const name of ['small-house-prod', 'small_house_production', 'app']) {
      const result = testDatabaseGuard(
        `postgresql://postgres:postgres@db.internal:5432/${name}`,
      );
      expect(result.ok, name).toBe(false);
    }
  });

  it('refuses a missing or unparseable connection string', () => {
    expect(testDatabaseGuard(undefined).ok).toBe(false);
    expect(testDatabaseGuard('').ok).toBe(false);
    expect(testDatabaseGuard('not-a-postgres-url').ok).toBe(false);
  });
});
