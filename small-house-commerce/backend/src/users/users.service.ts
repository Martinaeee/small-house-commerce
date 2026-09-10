import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import type { RoleCode } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

  async update(id: string, input: UpdateUserInput) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });

    if (!user) {
      throw new NotFoundException('User not found');
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

    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
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
