import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { reconcileOrderPermissions } from './reconcile-order-permissions.js';

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL as string },
  { schema: process.env.DATABASE_SCHEMA as string },
);
const prisma = new PrismaClient({ adapter });

reconcileOrderPermissions(prisma)
  .then((result) => {
    console.log(
      `Order RBAC reconciled: ${result.permissionCount} permissions, ${result.grantsCreated} grants created.`,
    );
    if (result.missingRoleCodes.length > 0) {
      console.warn(
        `Order RBAC awaits roles: ${result.missingRoleCodes.join(', ')}. Re-run after first-database bootstrap.`,
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
