import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import type { RoleCode } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateUserInput, UpdateUserInput } from './dto/user.dto.js';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: {
      role: { select: { code: true, name: true } },
    },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * The role catalogue for the admin UI. Names and descriptions live in the
   * `roles` table (written by the seed), so the page never hard-codes them.
   */
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      select: {
        code: true,
        name: true,
        description: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
      orderBy: { code: 'asc' },
    });

    return roles.map((role) => ({
      code: role.code,
      name: role.name,
      description: role.description,
      permissionCodes: role.permissions.map((grant) => grant.permission.code),
    }));
  }

  async create(input: CreateUserInput) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const roleIds = await this.resolveRoleIds(input.roleCodes);
    const passwordHash = await argon2.hash(input.password);

    return this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: USER_SELECT,
    });
  }

  /**
   * Updates a member. `actorId` is the administrator performing the change;
   * it enables the two guards that keep the back office from locking itself
   * out (see assertNotLastSuperAdmin).
   */
  async update(id: string, input: UpdateUserInput, actorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Self-protection: an administrator may not disable or re-role their own
    // account. Both actions are one keystroke away from locking every
    // administrator out of the back office.
    if (actorId && actorId === id) {
      if (input.status === 'DISABLED') {
        throw new BadRequestException('You cannot disable your own account');
      }
      if (input.roleCodes !== undefined) {
        throw new BadRequestException('You cannot change your own roles');
      }
    }

    if (input.email && input.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictException('Email is already registered');
      }
    }

    if (input.status === 'DISABLED' || input.roleCodes !== undefined) {
      await this.assertNotLastSuperAdmin(id, input);
    }

    const data: {
      name?: string;
      email?: string;
      status?: 'ACTIVE' | 'DISABLED';
      passwordHash?: string;
      roles?: { deleteMany: {}; create: { roleId: string }[] };
    } = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.status !== undefined) data.status = input.status;
    if (input.password !== undefined) data.passwordHash = await argon2.hash(input.password);

    if (input.roleCodes !== undefined) {
      const roleIds = await this.resolveRoleIds(input.roleCodes);
      data.roles = {
        deleteMany: {},
        create: roleIds.map((roleId) => ({ roleId })),
      };
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });

    // A replaced password ends every session the member holds, so a stale
    // refresh token cannot be used to keep working on the old password.
    if (input.password !== undefined) {
      await this.revokeSessions(id);
    }

    return updated;
  }

  /**
   * Keeps at least one active Super Admin in the system. A change that takes
   * the seat away from the last active Super Admin is rejected.
   *
   * The check and the write are not one atomic operation, so two
   * administrators acting at the same instant could in theory race past it.
   * The window is a single admin click and the consequence is recoverable by
   * editing the row directly, so a transaction is not worth the cost here.
   */
  private async assertNotLastSuperAdmin(id: string, input: UpdateUserInput): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: {
        status: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });

    if (!target) return;

    const holdsSuperAdmin = target.roles.some((row) => row.role.code === 'SUPER_ADMIN');
    if (!holdsSuperAdmin) return;

    const activeBefore = target.status === 'ACTIVE';
    const activeAfter = input.status === undefined ? activeBefore : input.status === 'ACTIVE';
    const superAdminAfter =
      input.roleCodes === undefined ? holdsSuperAdmin : input.roleCodes.includes('SUPER_ADMIN');

    // The seat only shrinks when an active Super Admin stops being one.
    if (!activeBefore || (activeAfter && superAdminAfter)) return;

    const others = await this.prisma.user.count({
      where: {
        id: { not: id },
        status: 'ACTIVE',
        roles: { some: { role: { code: 'SUPER_ADMIN' } } },
      },
    });

    if (others === 0) {
      throw new BadRequestException('At least one active Super Admin must remain');
    }
  }

  private async revokeSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async resolveRoleIds(codes: RoleCode[]): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });

    if (roles.length !== codes.length) {
      throw new BadRequestException('One or more role codes do not exist');
    }

    return roles.map((role) => role.id);
  }
}
