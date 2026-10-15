import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prerequisite = new URL(
  './migrations/20261015115900_add_order_customer_note/migration.sql',
  import.meta.url,
);

describe('Marketing order-schema prerequisite', () => {
  it('adds the missing nullable customer note without changing existing order rows', () => {
    expect(existsSync(prerequisite)).toBe(true);
    const sql = readFileSync(prerequisite, 'utf8');
    expect(sql).toMatch(/SET lock_timeout = '5s'/);
    expect(sql).toMatch(/ALTER TABLE "orders" ADD COLUMN "customer_note" TEXT;/);
    expect(sql).not.toMatch(/\b(?:NOT NULL|DEFAULT|UPDATE|DELETE|DROP)\b/i);
  });
});
