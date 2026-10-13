import {
  PermissionCode,
  PrismaClient,
  RoleCode,
} from "../src/generated/prisma/client.js";

const NEWSLETTER_PERMISSIONS = [
  {
    code: PermissionCode.NEWSLETTER_READ,
    description: "View newsletter subscribers.",
  },
  {
    code: PermissionCode.NEWSLETTER_WRITE,
    description: "Manage newsletter subscribers.",
  },
] as const;
const TARGET_ROLES = [RoleCode.SUPER_ADMIN, RoleCode.ADMIN] as const;

export interface NewsletterPermissionReconciliation {
  permissions: { id: string; code: PermissionCode }[];
  grantedRoleCodes: RoleCode[];
  missingRoleCodes: RoleCode[];
  grantsCreated: number;
}

export async function reconcileNewsletterPermissions(
  prisma: PrismaClient,
): Promise<NewsletterPermissionReconciliation> {
  return prisma.$transaction(async (tx) => {
    const permissions: { id: string; code: PermissionCode }[] = [];
    for (const definition of NEWSLETTER_PERMISSIONS) {
      permissions.push(
        await tx.permission.upsert({
          where: { code: definition.code },
          update: { description: definition.description },
          create: definition,
          select: { id: true, code: true },
        }),
      );
    }

    const roles = await tx.role.findMany({
      where: { code: { in: [...TARGET_ROLES] } },
      select: { id: true, code: true },
    });
    const found = new Set(roles.map((role) => role.code));
    const missingRoleCodes = TARGET_ROLES.filter((code) => !found.has(code));

    const created = await tx.rolePermission.createMany({
      data: roles.flatMap((role) =>
        permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
      ),
      skipDuplicates: true,
    });

    return {
      permissions,
      grantedRoleCodes: roles.map((role) => role.code),
      missingRoleCodes: [...missingRoleCodes],
      grantsCreated: created.count,
    };
  });
}
