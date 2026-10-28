import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import { QianyiClient } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';
import { QianyiInboundService } from './qianyi-inbound.service.js';

/**
 * Qianyi ERP integration.
 *
 * `InventoryService` arrives from the global InventoryModule, so it needs no
 * import here. `LogisticsEventService` is provided locally rather than by
 * importing OrdersModule: OrdersModule imports this module, and a circular
 * module dependency is worse than one extra stateless provider instance.
 */
@Module({
  imports: [AuthModule],
  providers: [QianyiClient, QianyiSyncService, QianyiInboundService, LogisticsEventService],
  exports: [QianyiClient, QianyiSyncService, QianyiInboundService],
})
export class QianyiModule {}
