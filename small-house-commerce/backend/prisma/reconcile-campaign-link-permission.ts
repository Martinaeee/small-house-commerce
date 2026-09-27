import {
  PermissionCode,
  PrismaClient,
  RoleCode,
} from "../src/generated/prisma/client.js";

const DESCRIPTION = "Build public product, variant and attribution links.";
const TARGET_ROLES = [
  RoleCode.SUPER_ADMIN,
  RoleCode.ADMIN,
  RoleCode.OPTIMIZER,
] as const;

export interface CampaignLinkPermissionReconciliation {
  permissionId: string;
  grantedRoleCodes: RoleCode[];
  missingRoleCodes: RoleCode[];
  grantsCreated: number;
}

export async function reconcileCampaignLinkPermission(
  prisma: PrismaClient,
): Promise<CampaignLinkPermissionReconciliation> {
  return prisma.$transaction(async (tx) => {
    const permission = await tx.permission.upsert({
      where: { code: PermissionCode.CAMPAIGN_LINK_BUILD },
      update: { description: DESCRIPTION },
      create: {
        code: PermissionCode.CAMPAIGN_LINK_BUILD,
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
