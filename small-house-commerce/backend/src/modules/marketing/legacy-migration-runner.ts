import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { backfillLegacyLandingPages, parseLegacyBackfillCommand } from './legacy-migration.js';

async function main() {
  const database = process.env.DATABASE_URL;
  const options = parseLegacyBackfillCommand(process.argv.slice(2), database);
  const prisma = new PrismaService(new ConfigService({ database: { url: database } }));
  try {
    const result = await backfillLegacyLandingPages(prisma, options);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
