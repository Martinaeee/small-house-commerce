import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { CustomerJwtGuard } from '../customer-jwt.guard.js';
import { CurrentCustomer } from '../current-customer.decorator.js';
import { StorefrontCustomerAuthService } from '../storefront-customer-auth.service.js';
import {
  customerOrdersQuerySchema,
  loginSchema,
  registerSchema,
  storefrontRefreshSchema,
  updateMeSchema,
  type CustomerOrdersQuery,
  type LoginInput,
  type RegisterInput,
  type StorefrontRefreshInput,
  type UpdateMeInput,
} from '../dto/storefront-customer.dto.js';

/** Public storefront customer account endpoints (spec §5.3). */
@Controller('storefront/customers')
export class StorefrontCustomersController {
  constructor(private readonly auth: StorefrontCustomerAuthService) {}

  @Post('register')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'customer-register:ip', bucket: 'ip', limit: 5, windowMs: 60 * 60_000 })
  @HttpCode(HttpStatus.CREATED)
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @UseGuards(ThrottleGuard)
  @Throttle(
    { key: 'customer-login:ip', bucket: 'ip', limit: 10, windowMs: 10 * 60_000 },
    // Per-email bucket is a deliberate brute-force guard (5 / 10 min).
    // Trade-off: anyone can deliberately lock a victim's email out for the
    // window; captcha or an email+IP compound key is future work.
    { key: 'customer-login:email', bucket: 'email', limit: 5, windowMs: 10 * 60_000 },
  )
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'customer-refresh:ip', bucket: 'ip', limit: 30, windowMs: 10 * 60_000 })
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(storefrontRefreshSchema)) body: StorefrontRefreshInput) {
    return this.auth.refresh(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body(new ZodValidationPipe(storefrontRefreshSchema)) body: StorefrontRefreshInput) {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(CustomerJwtGuard)
  me(@CurrentCustomer() customer: { accountId: string }) {
    return this.auth.me(customer.accountId);
  }

  @Patch('me')
  @UseGuards(CustomerJwtGuard)
  updateMe(
    @CurrentCustomer() customer: { accountId: string },
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ) {
    return this.auth.updateMe(customer.accountId, body);
  }

  @Get('me/orders')
  @UseGuards(CustomerJwtGuard)
  listOrders(
    @CurrentCustomer() customer: { accountId: string },
    @Query(new ZodValidationPipe(customerOrdersQuerySchema)) query: CustomerOrdersQuery,
  ) {
    return this.auth.listOrders(customer.accountId, query);
  }
}
