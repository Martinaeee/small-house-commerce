import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { MsDuration } from './auth.module.js';
import type { LoginInput, RefreshInput } from './dto/auth.dto.js';

/**
 * Parses a vercel/ms style duration ("30s", "1h", "7d") into milliseconds.
 * Kept inline to avoid a dependency for two well-known shapes.
 */
function durationToMillis(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration: "${value}" (expected e.g. "15m", "1h", "7d")`);
  }
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return Number(match[1]) * factor;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(this.prisma, user.id, user.email, randomUUID());

    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, status: user.status },
    };
  }

  async refresh(input: RefreshInput) {
    const tokenHash = hashToken(input.refreshToken);
    const now = new Date();

    // Throwing inside the callback would roll back the family revocation, so
    // the callback returns an outcome and the 401 is thrown after commit.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored) {
        return { status: 'invalid' as const };
      }

      if (stored.expiresAt <= now) {
        return { status: 'invalid' as const };
      }

      if (stored.revokedAt !== null) {
        // Reuse of an already-rotated token: revoke the entire family.
        await this.revokeFamily(tx, stored.userId, stored.familyId, stored.id);
        return { status: 'invalid' as const };
      }

      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      });

      const user = await tx.user.findUnique({ where: { id: stored.userId } });
      if (!user || user.status !== 'ACTIVE') {
        return { status: 'invalid' as const };
      }

      const tokens = await this.issueTokens(
        tx,
        user.id,
        user.email,
        stored.familyId ?? randomUUID(),
      );
      return { status: 'ok' as const, tokens };
    });

    if (outcome.status !== 'ok') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return outcome.tokens;
  }

  /**
   * Deletes every token in a rotation family. A null familyId can only exist
   * for a row written out-of-band (the migration backfills all real rows);
   * such a row is a singleton family of one.
   */
  private async revokeFamily(
    tx: Prisma.TransactionClient,
    userId: string,
    familyId: string | null,
    selfId: string,
  ): Promise<void> {
    if (familyId !== null) {
      await tx.refreshToken.deleteMany({ where: { userId, familyId } });
    } else {
      await tx.refreshToken.deleteMany({ where: { userId, id: selfId } });
    }
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    // Idempotent: unknown or already-revoked tokens are simply ignored.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(userId: string) {
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

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      roles: user.roles.map((userRole) => ({
        code: userRole.role.code,
        name: userRole.role.name,
      })),
      permissions: [
        ...new Set(
          user.roles.flatMap((userRole) =>
            userRole.role.permissions.map((grant) => grant.permission.code),
          ),
        ),
      ],
    };
  }

  private async issueTokens(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    email: string,
    familyId: string,
  ) {
    const accessTtl = this.config.getOrThrow<MsDuration>('jwt.accessTtl');
    const refreshTtl = this.config.getOrThrow<string>('jwt.refreshTtl');

    const accessToken = await this.jwt.signAsync({ sub: userId, email }, {
      expiresIn: accessTtl,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + durationToMillis(refreshTtl));

    await client.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, expiresAt };
  }
}
