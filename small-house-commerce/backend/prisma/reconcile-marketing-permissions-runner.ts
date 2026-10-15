import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { reconcileMarketingPermissions } from './reconcile-marketing-permissions.js';

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL as string },
  { schema: process.env.DATABASE_SCHEMA as string },
);
const prisma = new PrismaClient({ adapter });

reconcileMarketingPermissions(prisma)
  .then(result => {
    console.log(`Marketing RBAC reconciled: ${result.permissionCount} permissions, ${result.grantsCreated} grants created.`);
    if (result.missingRoleCodes.length > 0) {
      console.warn(`Marketing RBAC awaits roles: ${result.missingRoleCodes.join(', ')}. Re-run after first-database bootstrap.`);
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
