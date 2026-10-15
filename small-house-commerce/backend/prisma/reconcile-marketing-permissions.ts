import { PrismaClient, RoleCode } from '../src/generated/prisma/client.js';
import { RBAC_GRANTS, RBAC_PERMISSIONS } from './rbac.js';

export async function reconcileMarketingPermissions(prisma: PrismaClient) {
  const permissions = RBAC_PERMISSIONS.filter(permission => permission.code.startsWith('MARKETING_'));
  const targetRoleCodes = Object.values(RoleCode).filter(code =>
    permissions.some(permission => RBAC_GRANTS[code].includes(permission.code)),
  );
  return prisma.$transaction(async tx => {
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
        data: roles.filter(role => RBAC_GRANTS[role.code].includes(definition.code)).map(role => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
      grantsCreated += created.count;
    }
    return {
      permissionCount: permissions.length,
      grantsCreated,
      missingRoleCodes: targetRoleCodes.filter(code => !roles.some(role => role.code === code)),
    };
  });
}
