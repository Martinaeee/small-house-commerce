import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { assertManage, scopeFor, type MarketingAccount } from './marketing-access.js';

type MarketingRequest = Request & { user?: RequestUser; marketingAccount?: MarketingAccount };

export const CurrentMarketingAccount = createParamDecorator((_value: unknown, context: ExecutionContext): MarketingAccount =>
  context.switchToHttp().getRequest<MarketingRequest>().marketingAccount!,
);

@Injectable()
export class MarketingGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MarketingRequest>();
    const id = request.user?.userId;
    if (!id) throw new ForbiddenException();
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { status: true, roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } } },
    });
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException();
    const account = { id, permissions: user.roles.flatMap((row) => row.role.permissions.map((grant) => grant.permission.code)) };
    const scope = scopeFor(account);
    if (!['GET', 'HEAD'].includes(request.method)) assertManage(scope, id);
    request.marketingAccount = account;
    return true;
  }
}
