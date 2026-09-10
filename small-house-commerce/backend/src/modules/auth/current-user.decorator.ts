import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestUser } from './jwt-auth.guard.js';

/**
 * Injects the user attached by JwtAuthGuard. Only valid on endpoints behind
 * the guard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    return request.user!;
  },
);
