import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminCustomersController } from './admin/customers.controller.js';
import { CustomerJwtGuard } from './customer-jwt.guard.js';
import { CustomersService } from './customers.service.js';
import { StorefrontCustomerAuthService } from './storefront-customer-auth.service.js';
import { StorefrontCustomersController } from './storefront/customers.controller.js';

@Module({
  // AuthModule exports JwtModule; the customer guard injects JwtService.
  imports: [AuthModule],
  controllers: [AdminCustomersController, StorefrontCustomersController],
  providers: [CustomersService, StorefrontCustomerAuthService, CustomerJwtGuard],
  exports: [CustomersService],
})
export class CustomersModule {}
