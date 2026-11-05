import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const database = process.env.ADID_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/adid_migration_test') {
    throw new Error('Adid migration tests require the dedicated local adid_migration_test database.');
  }
}
const migration = readFileSync(new URL('./migrations/20261105120000_add_adid/migration.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-a111-111111111111';
const secondOwner = '22222222-2222-4222-a222-222222222222';

describe.skipIf(!database)('adid migration on PostgreSQL', () => {
  let prisma: PrismaService;
  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  async function apply(tx: Prisma.TransactionClient) {
    for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) {
      if (!/^(BEGIN|COMMIT)$/i.test(statement)) await tx.$executeRawUnsafe(statement);
    }
  }

  async function run(check: (tx: Prisma.TransactionClient) => Promise<void>) {
    const schema = `adid_test_${randomUUID().replaceAll('-', '')}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(`CREATE TABLE campaign_links (
        id UUID PRIMARY KEY, owner_user_id UUID, aid_snapshot TEXT,
        source_type TEXT, ad_id TEXT, created_at TIMESTAMPTZ, post_date DATE
      )`);
      await tx.$executeRawUnsafe(`CREATE TABLE order_attributions (
        id UUID PRIMARY KEY, link_id UUID, source_type TEXT, ad_id TEXT
      )`);
      await check(tx);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }, { timeout: 20_000 });
  }

  it('does not reuse a generated Meta number after mixing real IDs and missing IDs', async () => {
    await run(async (tx) => {
      await tx.$executeRaw`INSERT INTO campaign_links VALUES
        (gen_random_uuid(), ${owner}::uuid, 'OP-1', 'META_AD', '120-real', '2026-11-05T00:00:00Z', NULL),
        (gen_random_uuid(), ${owner}::uuid, 'OP-1', 'META_AD', NULL, '2026-11-05T01:00:00Z', NULL),
        (gen_random_uuid(), ${owner}::uuid, 'OP-1', 'META_AD', '', '2026-11-05T02:00:00Z', NULL)`;
      await apply(tx);
      expect(await tx.$queryRaw`SELECT adid FROM campaign_links ORDER BY created_at`).toEqual([
        { adid: '120-real' }, { adid: 'AD-OP-1-261105-01' }, { adid: 'AD-OP-1-261105-02' },
      ]);
      expect(await tx.$queryRaw`SELECT last_number FROM adid_counters`).toEqual([{ last_number: 2 }]);
    });
  });

  it('keeps all 105 posts distinct without truncating sequence 100', async () => {
    await run(async (tx) => {
      await tx.$executeRaw`INSERT INTO campaign_links
        SELECT gen_random_uuid(), ${owner}::uuid, 'OP-1', 'FB_POST', NULL,
          '2026-11-05T00:00:00Z'::timestamptz + n * interval '1 second', '2026-11-05'::date
        FROM generate_series(1, 105) n`;
      await apply(tx);
      expect(await tx.$queryRaw`SELECT count(DISTINCT adid)::int AS count FROM campaign_links`).toEqual([{ count: 105 }]);
      expect(await tx.$queryRaw`SELECT adid FROM campaign_links ORDER BY created_at DESC LIMIT 1`).toEqual([{ adid: 'FB-OP-1-261105-105' }]);
    });
  });

  it('preserves issued numbers after editing dates and resumes a partial backfill above the existing counter', async () => {
    await run(async (tx) => {
      await tx.$executeRaw`INSERT INTO campaign_links VALUES
        (gen_random_uuid(), ${owner}::uuid, 'OP-1', 'FB_POST', NULL, '2026-11-05T00:00:00Z', '2026-11-05')`;
      await apply(tx);
      await tx.$executeRaw`UPDATE campaign_links SET post_date = '2026-11-06'`;
      await tx.$executeRaw`INSERT INTO campaign_links (id, owner_user_id, aid_snapshot, source_type, created_at, post_date)
        VALUES (gen_random_uuid(), ${owner}::uuid, 'OP-1', 'FB_POST', '2026-11-05T01:00:00Z', '2026-11-05')`;
      await apply(tx);
      expect(await tx.$queryRaw`SELECT adid FROM campaign_links ORDER BY created_at`).toEqual([
        { adid: 'FB-OP-1-261105-01' }, { adid: 'FB-OP-1-261105-02' },
      ]);
      await apply(tx);
      expect(await tx.$queryRaw`SELECT day_key, last_number FROM adid_counters`).toEqual([{ day_key: '261105', last_number: 2 }]);
    });
  });

  it('backfills a real Meta ID on a legacy order without a link but never on an organic order', async () => {
    await run(async (tx) => {
      await tx.$executeRaw`INSERT INTO order_attributions VALUES
        (gen_random_uuid(), NULL, 'META_AD', '120-legacy-real'),
        (gen_random_uuid(), NULL, 'ORGANIC', 'ignore-client-id')`;
      await apply(tx);
      expect(await tx.$queryRaw`SELECT source_type, adid FROM order_attributions ORDER BY source_type`).toEqual([
        { source_type: 'META_AD', adid: '120-legacy-real' }, { source_type: 'ORGANIC', adid: null },
      ]);
    });
  });

  it('separates optimizers and Manila dates and copies one link number to all of its orders', async () => {
    await run(async (tx) => {
      const link = '33333333-3333-4333-a333-333333333333';
      await tx.$executeRaw`INSERT INTO campaign_links VALUES
        (${link}::uuid, ${owner}::uuid, 'OP-1', 'FB_POST', NULL, '2026-11-04T16:30:00Z', NULL),
        (gen_random_uuid(), ${secondOwner}::uuid, 'OP-2', 'FB_POST', NULL, '2026-11-04T16:30:00Z', NULL),
        (gen_random_uuid(), ${owner}::uuid, 'OP-1', 'ORGANIC', NULL, '2026-11-04T16:30:00Z', NULL)`;
      await tx.$executeRaw`INSERT INTO order_attributions (id, link_id, source_type) VALUES
        (gen_random_uuid(), ${link}::uuid, 'FB_POST'), (gen_random_uuid(), ${link}::uuid, 'FB_POST'),
        (gen_random_uuid(), NULL, 'ORGANIC')`;
      await apply(tx);
      expect(await tx.$queryRaw`SELECT adid FROM campaign_links ORDER BY aid_snapshot, source_type`).toEqual([
        { adid: 'FB-OP-1-261105-01' }, { adid: null }, { adid: 'FB-OP-2-261105-01' },
      ]);
      expect(await tx.$queryRaw`SELECT adid FROM order_attributions ORDER BY adid NULLS LAST`).toEqual([
        { adid: 'FB-OP-1-261105-01' }, { adid: 'FB-OP-1-261105-01' }, { adid: null },
      ]);
    });
  });
});
