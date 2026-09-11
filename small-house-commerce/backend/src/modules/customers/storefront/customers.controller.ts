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
  @HttpCode(HttpStatus.CREATED)
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('refresh')
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
