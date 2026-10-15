import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

const databases = {
  release_marketing_fresh_20261015: 'small_house_marketing_release_fresh_20261015',
  release_marketing_upgrade_20261015: 'small_house_marketing_release_upgrade_20261015',
} as const;

export interface MarketingTestDatabase {
  url: string;
  schema: string;
}

export function marketingTestDatabase(env: NodeJS.ProcessEnv = process.env): MarketingTestDatabase | undefined {
  const raw = env.MARKETING_TEST_DATABASE_URL;
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid Marketing test database URL.'); }
  const schema = env.MARKETING_TEST_DATABASE_SCHEMA;
  if (!schema || !Object.hasOwn(databases, schema)) throw new Error('Marketing tests require an owned explicit rehearsal schema.');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== `/${databases[schema as keyof typeof databases]}` || url.searchParams.get('schema') !== schema) {
    throw new Error('Marketing tests require the matching isolated local release database and schema.');
  }
  url.searchParams.set('options', `-c search_path=${schema}`);
  return { url: url.toString(), schema };
}

export function createMarketingTestPrisma(database: MarketingTestDatabase): PrismaService {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url }, { schema: database.schema }),
  }) as unknown as PrismaService;
}
