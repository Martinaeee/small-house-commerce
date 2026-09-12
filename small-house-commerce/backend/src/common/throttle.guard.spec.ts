import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import {
  THROTTLE_KEY,
  ThrottleGuard,
  type ThrottlePolicy,
} from './throttle.guard.js';

function contextFor(options: {
  ip: string;
  body?: unknown;
  handler: () => void;
}): { ctx: ExecutionContext; setHeader: ReturnType<typeof vi.fn> } {
  const setHeader = vi.fn();
  const ctx = {
    getHandler: () => options.handler,
    getClass: () => class ThrottledController {},
    switchToHttp: () => ({
      getRequest: () => ({ ip: options.ip, body: options.body ?? {} }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

/** Mirrors the post-decoration state @Throttle produces on a method. */
function handlerWith(policies: ThrottlePolicy[]): () => void {
  const handler = () => undefined;
  Reflect.defineMetadata(THROTTLE_KEY, policies, handler);
  return handler;
}

const ipPolicy: ThrottlePolicy = {
  key: 'test:ip',
  bucket: 'ip',
  limit: 2,
  windowMs: 60_000,
};
const emailPolicy: ThrottlePolicy = {
  key: 'test:email',
  bucket: 'email',
  limit: 1,
  windowMs: 60_000,
};

describe('ThrottleGuard', () => {
  it('passes under the limit', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy]);
    const { ctx } = contextFor({ ip: '203.0.113.1', handler });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks with the Nest envelope and a Retry-After header past the limit', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy]);
    const { ctx, setHeader } = contextFor({ ip: '203.0.113.2', handler });

    guard.canActivate(ctx);
    guard.canActivate(ctx);

    try {
      guard.canActivate(ctx);
      throw new Error('expected HttpException');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(httpError.getResponse()).toEqual({
        statusCode: 429,
        message: 'Too many requests',
        error: 'Too Many Requests',
      });
      expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
      expect(Number(setHeader.mock.calls[0]![1])).toBeGreaterThanOrEqual(1);
    }
  });

  it('applies the email bucket across different IPs and ignores email casing/spacing', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy, emailPolicy]);

    const first = contextFor({ ip: '203.0.113.3', body: { email: 'Juan@Example.com ' }, handler });
    const second = contextFor({ ip: '203.0.113.4', body: { email: ' juan@example.com' }, handler });
    expect(guard.canActivate(first.ctx)).toBe(true);
    expect(() => guard.canActivate(second.ctx)).toThrow(HttpException);
  });

  it('skips the email bucket when no email is present (IP bucket still applies)', () => {
    const guard = new ThrottleGuard();
    const handler = handlerWith([ipPolicy, emailPolicy]);
    const { ctx } = contextFor({ ip: '203.0.113.5', body: { refreshToken: 'x' }, handler });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows routes without throttle metadata', () => {
    const guard = new ThrottleGuard();
    const { ctx } = contextFor({ ip: '203.0.113.6', handler: () => undefined });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
