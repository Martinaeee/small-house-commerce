import { PrismaPg } from '@prisma/adapter-pg';
import {
  PermissionCode,
  PrismaClient,
  RoleCode,
} from '../src/generated/prisma/client.js';
import { assertFaqE2ETestTarget } from './e2e-faq-test-target.js';

/**
 * E2E-only role fixture for the FAQ permission-split scenarios.
 *
 * The FAQ closeout scenarios need one account holding exactly
 * PRODUCT_FAQ_SHARED_MANAGE and another holding exactly PRODUCT_MANAGE. The
 * seeded roles never have that shape, and RoleCode is a database enum, so the
 * scenarios reuse the seeded OPTIMIZER/WAREHOUSE accounts and grant their
 * roles one extra permission for the duration of the test. `revoke` removes
 * exactly those grants; the spec always runs it in `finally`.
 */
const MODE = process.argv[2];
if (MODE !== 'grant' && MODE !== 'revoke') {
  throw new Error('usage: e2e-faq-role-grants.ts grant|revoke');
}

const databaseUrl = process.env.DATABASE_URL;
assertFaqE2ETestTarget(databaseUrl, process.env.E2E_PG_PORT ?? '5432');
const connectionString = new URL(databaseUrl!);
connectionString.searchParams.delete('schema');

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: connectionString.toString() },
    { schema: 'public' },
  ),
});

const PAIRS = [
  {
    roleCode: RoleCode.OPTIMIZER,
    permissionCode: PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
  },
  {
    roleCode: RoleCode.WAREHOUSE,
    permissionCode: PermissionCode.PRODUCT_MANAGE,
  },
] as const;

async function main(): Promise<void> {
  for (const pair of PAIRS) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: pair.roleCode },
      select: { id: true },
    });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: pair.permissionCode },
      select: { id: true },
    });
    if (MODE === 'grant') {
      await prisma.rolePermission.createMany({
        data: [{ roleId: role.id, permissionId: permission.id }],
        skipDuplicates: true,
      });
    } else {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  console.log(`faq role grants ${MODE}: ok`);
}

main().then(
  () => prisma.$disconnect(),
  (error: unknown) => {
    console.error(error);
    void prisma.$disconnect().finally(() => {
      process.exitCode = 1;
    });
  },
);
