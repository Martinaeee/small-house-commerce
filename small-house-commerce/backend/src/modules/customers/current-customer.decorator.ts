import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestCustomer } from './customer-jwt.guard.js';

/** Injects the customer attached by CustomerJwtGuard. */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestCustomer => {
    const request = context
      .switchToHttp()
      .getRequest<{ customer?: RequestCustomer }>();
    return request.customer!;
  },
);
