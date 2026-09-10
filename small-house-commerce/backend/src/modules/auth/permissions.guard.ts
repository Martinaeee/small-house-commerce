import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RequestUser } from './jwt-auth.guard.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';

type AuthenticatedRequest = Request & { user?: RequestUser };

/**
 * Enforces @Permissions(...) metadata by loading the user's roles and
 * permissions from the database. Runs after JwtAuthGuard; without metadata it
 * allows any authenticated user through.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new ForbiddenException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException();
    }

    const granted = new Set<PermissionCode>(
      user.roles.flatMap((userRole) =>
        userRole.role.permissions.map((grant) => grant.permission.code),
      ),
    );

    if (!required.every((code) => granted.has(code))) {
      throw new ForbiddenException('Missing required permission');
    }

    return true;
  }
}
