import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersService } from './orders.service.js';
import { CustomerRiskService } from './customer-risk.service.js';
import { StorefrontOrdersController } from './storefront/orders.controller.js';
import { AdminOrdersController, AdminCustomersController } from './admin/orders.controller.js';

/**
 * Orders: guest COD checkout (storefront) and admin list/detail/confirm/cancel.
 * InventoryService is global (InventoryModule), so reserve/release resolve
 * without an explicit import here. AuthModule is imported for its exported
 * JwtModule, which the admin guards inject.
 */
@Module({
  imports: [AuthModule],
  controllers: [StorefrontOrdersController, AdminOrdersController, AdminCustomersController],
  providers: [OrdersService, CustomerRiskService],
})
export class OrdersModule {}
