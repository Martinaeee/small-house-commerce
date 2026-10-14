import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { reconcileProductFaqPermission } from './reconcile-product-faq-permission.js';

const adapter = new PrismaPg(
  {
    connectionString: process.env.DATABASE_URL as string,
  },
  { schema: process.env.DATABASE_SCHEMA as string },
);
const prisma = new PrismaClient({ adapter });

reconcileProductFaqPermission(prisma)
  .then((result) => {
    console.log(
      `PRODUCT_FAQ_SHARED_MANAGE reconciled for ${result.grantedRoleCodes.join(', ') || 'no existing roles'} (${result.grantsCreated} grants created).`,
    );
    if (result.missingRoleCodes.length > 0) {
      console.warn(
        `PRODUCT_FAQ_SHARED_MANAGE awaits roles: ${result.missingRoleCodes.join(', ')}. Re-run after first-database bootstrap.`,
      );
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
