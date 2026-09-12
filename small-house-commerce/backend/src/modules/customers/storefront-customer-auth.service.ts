import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { normalizePhilippinePhone } from '../../common/phone.util.js';
import type { MsDuration } from '../auth/auth.module.js';
import type {
  CustomerOrdersQuery,
  LoginInput,
  RegisterInput,
  StorefrontRefreshInput,
  UpdateMeInput,
} from './dto/storefront-customer.dto.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function durationToMillis(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: "${value}"`);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return Number(match[1]) * factor;
}

type AccountWithCustomer = {
  id: string;
  email: string;
  name: string;
  customerId: string | null;
  customer?: { normalizedPhone: string } | null;
};

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface StorefrontOrderSummary {
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  grandTotal: number;
  createdAt: Date;
  items: {
    productNameSnapshot: string;
    variantSnapshot: string;
    quantity: number;
    lineTotal: number;
  }[];
}

const ORDER_SUMMARY_SELECT = {
  orderNumber: true,
  orderStatus: true,
  paymentStatus: true,
  currency: true,
  grandTotal: true,
  createdAt: true,
  items: {
    select: {
      productNameSnapshot: true,
      variantSnapshot: true,
      quantity: true,
      lineTotal: true,
    },
  },
} as const;

@Injectable()
export class StorefrontCustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: RegisterInput): Promise<TokenPair & { account: CustomerProfile }> {
    // The login identity is the lowercase email (the Zod DTO also transforms
    // it; normalize here too so the uniqueness check/create can never diverge).
    const email = input.email.toLowerCase();
    const existing = await this.prisma.customerAccount.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    let account;
    try {
      account = await this.prisma.customerAccount.create({
        data: {
          email,
          name: input.name,
          passwordHash: await argon2.hash(input.password),
        },
      });
    } catch (error) {
      // A concurrent registration can win the unique email between the
      // pre-check and the insert (P2002); answer with the same 409.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
    const tokens = await this.issueTokens(this.prisma, account.id, account.email, randomUUID());

    return {
      ...tokens,
      account: { id: account.id, name: account.name, email: account.email, phone: null },
    };
  }

  async login(input: LoginInput): Promise<TokenPair & { account: CustomerProfile }> {
    const account = await this.prisma.customerAccount.findUnique({
      where: { email: input.email },
      include: { customer: { select: { normalizedPhone: true } } },
    });
    if (!account) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await argon2.verify(account.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const tokens = await this.issueTokens(this.prisma, account.id, account.email, randomUUID());
    return { ...tokens, account: this.toProfile(account) };
  }

  async refresh(input: StorefrontRefreshInput): Promise<TokenPair> {
    const tokenHash = hashToken(input.refreshToken);
    const now = new Date();

    // The callback must not throw on the reuse path (Prisma would roll the
    // family deletion back); return an outcome and 401 after commit instead.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.customerRefreshToken.findUnique({
        where: { tokenHash },
      });
      if (!stored) {
        return { status: 'invalid' as const };
      }

      if (stored.expiresAt <= now) {
        return { status: 'invalid' as const };
      }

      if (stored.revokedAt !== null) {
        await this.revokeFamily(tx, stored.accountId, stored.familyId, stored.id);
        return { status: 'invalid' as const };
      }

      // Atomic claim. READ COMMITTED lets two concurrent refreshes read the
      // same unrevoked row; the conditional update is re-evaluated against
      // the latest committed row version under the row lock, so exactly one
      // transaction counts 1. A count of 0 means a concurrent request won —
      // take the reuse path and wipe the family.
      const claimed = await tx.customerRefreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (claimed.count !== 1) {
        await this.revokeFamily(tx, stored.accountId, stored.familyId, stored.id);
        return { status: 'invalid' as const };
      }

      const account = await tx.customerAccount.findUnique({
        where: { id: stored.accountId },
        select: { id: true, email: true },
      });
      if (!account) {
        return { status: 'invalid' as const };
      }

      const tokens = await this.issueTokens(
        tx,
        account.id,
        account.email,
        stored.familyId ?? randomUUID(),
      );
      return { status: 'ok' as const, tokens };
    });

    if (outcome.status !== 'ok') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return outcome.tokens;
  }

  /** Deletes every customer token in a rotation family (null = out-of-band singleton row). */
  private async revokeFamily(
    tx: Prisma.TransactionClient,
    accountId: string,
    familyId: string | null,
    selfId: string,
  ): Promise<void> {
    if (familyId !== null) {
      await tx.customerRefreshToken.deleteMany({ where: { accountId, familyId } });
    } else {
      await tx.customerRefreshToken.deleteMany({ where: { accountId, id: selfId } });
    }
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.customerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(accountId: string): Promise<CustomerProfile> {
    const account = await this.requireAccount(accountId);
    return this.toProfile(account);
  }

  async updateMe(accountId: string, input: UpdateMeInput): Promise<CustomerProfile> {
    const account = await this.requireAccount(accountId);

    if (input.phone !== undefined) {
      const normalizedPhone = normalizePhilippinePhone(input.phone);
      if (!normalizedPhone) {
        throw new BadRequestException('Please enter a valid Philippine mobile number');
      }
      // Linking runs in a transaction so the account/Customer stay consistent.
      // A conflicting owner throws, rolling back the upsert/backfill too.
      try {
        await this.prisma.$transaction(async (tx) => {
          // A combined name+phone PATCH must seed/backfill the phone-keyed
          // Customer snapshot with the NEW name, not the pre-update value.
          const effectiveName = input.name ?? account.name;
          const customer = await tx.customer.upsert({
            where: { normalizedPhone },
            // A brand-new phone-keyed Customer inherits the account identity.
            create: { normalizedPhone, name: effectiveName, email: account.email },
            update: {},
          });
          // Backfill the COD customer snapshot only where checkout left gaps.
          await tx.customer.updateMany({
            where: { id: customer.id, name: null },
            data: { name: effectiveName },
          });
          await tx.customer.updateMany({
            where: { id: customer.id, email: null },
            data: { email: account.email },
          });
          const owner = await tx.customerAccount.findUnique({
            where: { customerId: customer.id },
            select: { id: true },
          });
          if (owner && owner.id !== accountId) {
            throw new ConflictException('This phone number is linked to another account');
          }
          await tx.customerAccount.update({
            where: { id: accountId },
            data: {
              customerId: customer.id,
              ...(input.name !== undefined ? { name: input.name } : {}),
            },
          });
        });
      } catch (error) {
        // A concurrent link can win the unique customerId/phone between the
        // owner check and the update (P2002); answer with the same 409.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('This phone number is linked to another account');
        }
        throw error;
      }
    } else if (input.name !== undefined) {
      await this.prisma.customerAccount.update({
        where: { id: accountId },
        data: { name: input.name },
      });
    }

    return this.me(accountId);
  }

  async listOrders(
    accountId: string,
    query: CustomerOrdersQuery,
  ): Promise<{
    items: StorefrontOrderSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const account = await this.requireAccount(accountId);
    if (!account.customerId) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { customerId: account.customerId },
        select: ORDER_SUMMARY_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where: { customerId: account.customerId } }),
    ]);

    const items = rows.map((order) => ({
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      currency: order.currency,
      grandTotal: Number(order.grandTotal),
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        productNameSnapshot: item.productNameSnapshot,
        variantSnapshot: item.variantSnapshot,
        quantity: item.quantity,
        lineTotal: Number(item.lineTotal),
      })),
    }));

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private async requireAccount(accountId: string): Promise<AccountWithCustomer> {
    const account = await this.prisma.customerAccount.findUnique({
      where: { id: accountId },
      include: { customer: { select: { normalizedPhone: true } } },
    });
    if (!account) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return account;
  }

  private toProfile(account: AccountWithCustomer): CustomerProfile {
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      phone: account.customer?.normalizedPhone ?? null,
    };
  }

  private async issueTokens(
    client: Prisma.TransactionClient | PrismaService,
    accountId: string,
    email: string,
    familyId: string,
  ): Promise<TokenPair> {
    const accessTtl = this.config.getOrThrow<MsDuration>('jwt.accessTtl');
    const refreshTtl = this.config.getOrThrow<string>('jwt.refreshTtl');

    const accessToken = await this.jwt.signAsync(
      { sub: accountId, email, kind: 'customer' },
      { expiresIn: accessTtl },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + durationToMillis(refreshTtl));

    await client.customerRefreshToken.create({
      data: { accountId, familyId, tokenHash: hashToken(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, expiresAt };
  }
}
