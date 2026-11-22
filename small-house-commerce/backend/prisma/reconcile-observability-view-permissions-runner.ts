import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { reconcileObservabilityViewPermissions } from './reconcile-observability-view-permissions.js';

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL as string },
  { schema: process.env.DATABASE_SCHEMA as string },
);
const prisma = new PrismaClient({ adapter });

reconcileObservabilityViewPermissions(prisma)
  .then((result) => {
    console.log(
      `Analytics-view RBAC reconciled: ${result.permissionCount} permissions, ${result.grantsCreated} grants created.`,
    );
    if (result.missingRoleCodes.length > 0) {
      console.warn(
        `Analytics-view RBAC awaits roles: ${result.missingRoleCodes.join(', ')}. Re-run after first-database bootstrap.`,
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
