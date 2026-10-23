import { PrismaClient, RoleCode } from '../src/generated/prisma/client.js';
import { RBAC_GRANTS, RBAC_PERMISSIONS } from './rbac.js';

/**
 * The order permissions that were added with the stage-1A workbench.
 *
 * The migration only adds the enum values (PostgreSQL cannot use a new
 * enum value in the same transaction that adds it), so the permission rows
 * and their role grants are written here - the same way the marketing,
 * newsletter and FAQ permissions are bootstrapped.
 */
const ORDER_PERMISSION_CODES = new Set<string>([
  'ORDER_ASSIGN',
  'ORDER_VERIFY',
  'ORDER_NOTE_WRITE',
  'ORDER_RISK_WRITE',
  'ORDER_MERGE',
  'ORDER_HANDOVER',
]);

export async function reconcileOrderPermissions(prisma: PrismaClient) {
  const permissions = RBAC_PERMISSIONS.filter((permission) =>
    ORDER_PERMISSION_CODES.has(permission.code),
  );
  const targetRoleCodes = Object.values(RoleCode).filter((code) =>
    permissions.some((permission) => RBAC_GRANTS[code].includes(permission.code)),
  );
  return prisma.$transaction(async (tx) => {
    const roles = await tx.role.findMany({
      where: { code: { in: targetRoleCodes } },
      select: { id: true, code: true },
    });
    let grantsCreated = 0;
    for (const definition of permissions) {
      const permission = await tx.permission.upsert({
        where: { code: definition.code },
        create: definition,
        update: { description: definition.description },
        select: { id: true },
      });
      const created = await tx.rolePermission.createMany({
        data: roles
          .filter((role) => RBAC_GRANTS[role.code].includes(definition.code))
          .map((role) => ({ roleId: role.id, permissionId: permission.id })),
        skipDuplicates: true,
      });
      grantsCreated += created.count;
    }
    return {
      permissionCount: permissions.length,
      grantsCreated,
      missingRoleCodes: targetRoleCodes.filter((code) => !roles.some((role) => role.code === code)),
    };
  });
}
