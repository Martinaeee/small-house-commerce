import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import { QianyiClient } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';
import { QianyiInboundService } from './qianyi-inbound.service.js';
import { QianyiWebhookService } from './qianyi-webhook.service.js';
import { QianyiWebhookController } from './qianyi-webhook.controller.js';

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
  controllers: [QianyiWebhookController],
  providers: [
    QianyiClient,
    QianyiSyncService,
    QianyiInboundService,
    QianyiWebhookService,
    LogisticsEventService,
  ],
  exports: [QianyiClient, QianyiSyncService, QianyiInboundService],
})
export class QianyiModule {}
