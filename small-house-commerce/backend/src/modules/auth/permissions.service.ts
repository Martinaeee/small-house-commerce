import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The permissions a user actually holds.
 *
 * The guard uses it for the static @Permissions(...) metadata; a handler
 * uses it when a second permission depends on the request (a status change
 * that cancels an order needs ORDER_CANCEL on top of ORDER_CONFIRM).
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async granted(userId: string): Promise<Set<PermissionCode>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
    if (!user || user.status !== 'ACTIVE') return new Set<PermissionCode>();
    return new Set<PermissionCode>(
      user.roles.flatMap((userRole) =>
        userRole.role.permissions.map((grant) => grant.permission.code),
      ),
    );
  }

  async has(userId: string, code: PermissionCode): Promise<boolean> {
    return (await this.granted(userId)).has(code);
  }
}
