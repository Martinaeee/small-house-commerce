import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
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

    const tokens = await this.issueTokens(user.id, user.email);

    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, status: user.status },
    };
  }

  async refresh(input: RefreshInput) {
    const tokenHash = hashToken(input.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt !== null || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate: revoke the presented token, then issue a new pair. A replayed
    // old token now finds itself revoked and is rejected.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(user.id, user.email);
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

  private async issueTokens(userId: string, email: string) {
    const accessTtl = this.config.getOrThrow<MsDuration>('jwt.accessTtl');
    const refreshTtl = this.config.getOrThrow<string>('jwt.refreshTtl');

    const accessToken = await this.jwt.signAsync({ sub: userId, email }, {
      expiresIn: accessTtl,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + durationToMillis(refreshTtl));

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, expiresAt };
  }
}
