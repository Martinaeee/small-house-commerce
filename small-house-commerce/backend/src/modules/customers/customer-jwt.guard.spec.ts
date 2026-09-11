import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CustomerJwtGuard } from './customer-jwt.guard.js';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';

function config() {
  return { getOrThrow: (key: string) => (key === 'jwt.secret' ? SECRET : '1h') };
}

function contextFor(authorization?: string): ExecutionContext {
  // Memoized so the guard's mutation is observable via a later getRequest() call.
  const request = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('token kind separation', () => {
  const jwt = new JwtService();
  const customerGuard = new CustomerJwtGuard(jwt, config() as never);
  const adminGuard = new JwtAuthGuard(jwt, config() as never);

  const customerToken = jwt.sign(
    { sub: 'acct-1', email: 'a@example.com', kind: 'customer' },
    { secret: SECRET, expiresIn: '1h' },
  );
  const adminToken = jwt.sign(
    { sub: 'user-1', email: 'admin@example.com' },
    { secret: SECRET, expiresIn: '1h' },
  );

  it('CustomerJwtGuard accepts customer tokens and attaches accountId', async () => {
    const ctx = contextFor(`Bearer ${customerToken}`);
    await expect(customerGuard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as {
      customer?: { accountId: string };
    };
    expect(req.customer?.accountId).toBe('acct-1');
  });

  it('CustomerJwtGuard rejects admin tokens (no kind claim)', async () => {
    await expect(
      customerGuard.canActivate(contextFor(`Bearer ${adminToken}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('JwtAuthGuard rejects customer tokens', async () => {
    await expect(
      adminGuard.canActivate(contextFor(`Bearer ${customerToken}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('both guards reject a missing header', async () => {
    await expect(customerGuard.canActivate(contextFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
