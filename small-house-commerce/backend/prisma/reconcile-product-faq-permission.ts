import {
  PermissionCode,
  PrismaClient,
  RoleCode,
} from '../src/generated/prisma/client.js';

const DESCRIPTION =
  'Edit the site-wide shared FAQ library every product may use.';
const TARGET_ROLES = [RoleCode.SUPER_ADMIN, RoleCode.ADMIN] as const;

export interface ProductFaqPermissionReconciliation {
  permissionId: string;
  grantedRoleCodes: RoleCode[];
  missingRoleCodes: RoleCode[];
  grantsCreated: number;
}

export async function reconcileProductFaqPermission(
  prisma: PrismaClient,
): Promise<ProductFaqPermissionReconciliation> {
  return prisma.$transaction(async (tx) => {
    const permission = await tx.permission.upsert({
      where: { code: PermissionCode.PRODUCT_FAQ_SHARED_MANAGE },
      update: { description: DESCRIPTION },
      create: {
        code: PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
        description: DESCRIPTION,
      },
      select: { id: true },
    });

    const roles = await tx.role.findMany({
      where: { code: { in: [...TARGET_ROLES] } },
      select: { id: true, code: true },
    });
    const found = new Set(roles.map((role) => role.code));
    const missingRoleCodes = TARGET_ROLES.filter((code) => !found.has(code));

    const created = await tx.rolePermission.createMany({
      data: roles.map((role) => ({
        roleId: role.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });

    return {
      permissionId: permission.id,
      grantedRoleCodes: roles.map((role) => role.code),
      missingRoleCodes: [...missingRoleCodes],
      grantsCreated: created.count,
    };
  });
}
