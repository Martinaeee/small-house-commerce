import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface RequestCustomer {
  accountId: string;
  email: string;
}

type AuthenticatedRequest = Request & { customer?: RequestCustomer };

/**
 * Storefront guard: accepts ONLY access tokens carrying kind: "customer".
 * Admin tokens (no kind claim) are rejected, keeping the two identities
 * from ever being interchangeable.
 */
@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        kind?: string;
      }>(header.slice('Bearer '.length), {
        secret: this.config.getOrThrow<string>('jwt.secret'),
      });
      if (payload.kind !== 'customer') {
        throw new UnauthorizedException('Invalid or expired token');
      }
      request.customer = { accountId: payload.sub, email: payload.email };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
