import { describe, expect, it } from 'vitest';
import { marketingTestDatabase } from '../../../test/marketing-test-prisma.js';

const fresh = 'release_marketing_fresh_20261015';
const freshUrl = 'postgresql://postgres:test-only@127.0.0.1:5432/small_house_marketing_release_fresh_20261015?schema=release_marketing_fresh_20261015';

function environment(url = freshUrl, schema = fresh): NodeJS.ProcessEnv {
  return { MARKETING_TEST_DATABASE_URL: url, MARKETING_TEST_DATABASE_SCHEMA: schema };
}

describe('Marketing PostgreSQL fixture isolation', () => {
  it('leaves integration disabled when no database was explicitly supplied', () => {
    expect(marketingTestDatabase({})).toBeUndefined();
  });

  it.each([
    [fresh, freshUrl],
    ['release_marketing_upgrade_20261015', 'postgresql://postgres:test-only@localhost:5432/small_house_marketing_release_upgrade_20261015?schema=release_marketing_upgrade_20261015'],
  ])('binds the owned %s database and raw SQL search path together', (schema, url) => {
    const config = marketingTestDatabase(environment(url, schema))!;
    expect(config.schema).toBe(schema);
    expect(new URL(config.url).searchParams.get('options')).toBe(`-c search_path=${schema}`);
  });

  it.each([
    ['remote host', freshUrl.replace('127.0.0.1', 'db.example.test'), fresh],
    ['shared app database', freshUrl.replace('small_house_marketing_release_fresh_20261015', 'small_house'), fresh],
    ['old marketing database', freshUrl.replace('small_house_marketing_release_fresh_20261015', 'small_house_marketing_dev'), fresh],
    ['mismatched database', freshUrl.replace('release_fresh_20261015', 'release_upgrade_20261015'), fresh],
    ['public schema', freshUrl, 'public'],
    ['missing schema', freshUrl, ''],
    ['mismatched URL schema', freshUrl.replace('schema=release_marketing_fresh_20261015', 'schema=public'), fresh],
  ])('rejects %s before a database client can be created', (_name, url, schema) => {
    expect(() => marketingTestDatabase(environment(url, schema))).toThrow(/Marketing tests require/);
  });

  it('replaces a caller-supplied public search path with the owned namespace', () => {
    const config = marketingTestDatabase(environment(`${freshUrl}&options=-c%20search_path%3Dpublic`))!;
    expect(new URL(config.url).searchParams.get('options')).toBe(`-c search_path=${fresh}`);
  });
});
