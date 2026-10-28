import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import { OrdersModule } from '../orders/orders.module.js';
import {
  AdminJtController,
  JtShipmentTrackingController,
} from './jt-admin.controller.js';
import { JtClient } from './jt.client.js';
import { JtTrackingService } from './jt-tracking.service.js';

/**
 * J&T Express tracking.
 *
 * `LogisticsEventService` is provided locally rather than imported: OrdersModule
 * does not export it, and the provider is stateless. OrdersModule is imported
 * for `OrdersService.sign` and exports it one-way — OrdersModule never imports
 * this module, so there is no cycle.
 */
@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [AdminJtController, JtShipmentTrackingController],
  providers: [JtClient, JtTrackingService, LogisticsEventService],
  exports: [JtClient, JtTrackingService],
})
export class JtModule {}
