import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MetaCapiModule } from '../meta-capi/meta-capi.module.js';
import { NewsletterModule } from '../newsletter/newsletter.module.js';
import { OrdersService } from './orders.service.js';
import { CustomerRiskService } from './customer-risk.service.js';
import { StorefrontOrdersController } from './storefront/orders.controller.js';
import { AdminOrdersController, AdminCustomersController } from './admin/orders.controller.js';
import { AdminOrderVerificationController } from './admin/order-verification.controller.js';
import { OrderVerificationService } from './verification.service.js';
import { OrderHandoverService } from './handover.service.js';
import { LogisticsEventService } from './logistics-event.service.js';
import { ReturnAcceptanceService } from './return-acceptance.service.js';

/**
 * Orders: guest COD checkout (storefront) and admin list/detail/confirm/cancel.
 * InventoryService is global (InventoryModule), so reserve/release resolve
 * without an explicit import here. AuthModule is imported for its exported
 * JwtModule, which the admin guards inject.
 */
@Module({
  imports: [AuthModule, CatalogModule, MetaCapiModule, NewsletterModule],
  controllers: [
    StorefrontOrdersController,
    AdminOrdersController,
    AdminCustomersController,
    AdminOrderVerificationController,
  ],
  providers: [
    OrdersService,
    CustomerRiskService,
    OrderVerificationService,
    OrderHandoverService,
    LogisticsEventService,
    ReturnAcceptanceService,
  ],
})
export class OrdersModule {}
