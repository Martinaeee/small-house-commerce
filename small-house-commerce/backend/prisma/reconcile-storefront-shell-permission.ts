import {
  PermissionCode,
  PrismaClient,
  RoleCode,
} from "../src/generated/prisma/client.js";

const DESCRIPTION =
  "Edit and publish the storefront Header, Footer, brand marks and base theme.";
const TARGET_ROLES = [RoleCode.SUPER_ADMIN] as const;

export interface StorefrontShellPermissionReconciliation {
  permissionId: string;
  grantedRoleCodes: RoleCode[];
  missingRoleCodes: RoleCode[];
  grantsCreated: number;
}

export async function reconcileStorefrontShellPermission(
  prisma: PrismaClient,
): Promise<StorefrontShellPermissionReconciliation> {
  return prisma.$transaction(async (tx) => {
    const permission = await tx.permission.upsert({
      where: { code: PermissionCode.STOREFRONT_SHELL_MANAGE },
      update: { description: DESCRIPTION },
      create: {
        code: PermissionCode.STOREFRONT_SHELL_MANAGE,
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
