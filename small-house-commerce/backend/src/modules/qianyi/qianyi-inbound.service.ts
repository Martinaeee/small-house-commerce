import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LogisticsEventService, type LogisticsStatus } from '../orders/logistics-event.service.js';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';

/** 千易物流状态 → 我们归一的物流状态。未知状态不猜，返回 null。 */
const TRACKING_STATUS: Record<string, LogisticsStatus> = {
  CREATED: 'SHIPPED',
  AVAILABLE_FOR_PICKUP: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'SIGNED',
  NOT_FOUND: 'FAILED_DELIVERY',
  CANCEL: 'RETURNING',
};

interface OutboundPayload {
  onlineOrderNumber?: string;
  orderNumber?: string;
  trackNumber?: string;
  trackingNumber?: string;
  carrier?: string;
  status?: string;
  shippingTime?: number;
  skuList?: Array<{ sku?: string; quantity?: number }>;
}

/**
 * Applies Qianyi callbacks to the order. Everything here is deliberate about
 * not trusting the payload: an unknown order, an unmapped SKU or a zero
 * quantity changes nothing and leaves a note for the operator instead.
 */
@Injectable()
export class QianyiInboundService {
  private readonly logger = new Logger(QianyiInboundService.name);
  private readonly config: QianyiConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly logistics: LogisticsEventService,
    config: ConfigService,
  ) {
    this.config = readQianyiConfig(config);
  }

  async handle(serviceType: string, payload: Record<string, unknown>): Promise<void> {
    switch (serviceType) {
      case 'PUSH_ODO_ORDER':
        await this.applyOutbound(payload as OutboundPayload);
        return;
      case 'PUSH_SALES_ORDER_SHIPPING_INFO':
        await this.applyShippingInfo(payload as OutboundPayload);
        return;
      case 'PUSH_TRACKING_PACKAGE':
        await this.applyTracking(payload as OutboundPayload);
        return;
      default:
        // PUSH_RETURN_ORDER_INFO: archived only, inventory untouched.
        this.logger.log(`qianyi ${serviceType} archived without side effects`);
    }
  }

  private async applyOutbound(payload: OutboundPayload): Promise<void> {
    if (payload.status !== 'SHIPPED') return;
    const orderNumber = payload.onlineOrderNumber;
    if (!orderNumber) return;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        include: { items: true, shipments: { include: { items: true } }, riskFlags: true },
      });
      if (!order) {
        this.logger.warn(`qianyi outbound for unknown order ${orderNumber}`);
        return;
      }
      // A repeated outbound must not create a second box. The outbound number
      // is the only safe identity: an order shipped by hand has a Shipment
      // already, and its Qianyi callback still has to be applied.
      const outbound = payload.orderNumber ?? null;
      const duplicate = outbound
        ? order.shipments.some(
            (shipment) => shipment.qianyiOutboundNumber === outbound,
          )
        : order.shipments.length > 0;
      if (duplicate) return;

      // Resolve what actually left the warehouse BEFORE touching inventory:
      // a short shipment must consume only what was sent.
      const shippedByCode = new Map<string, number>();
      for (const line of payload.skuList ?? []) {
        const code = line.sku ?? '';
        shippedByCode.set(code, (shippedByCode.get(code) ?? 0) + Number(line.quantity ?? 0));
      }
      // An outbound that lists lines is a complete statement of what shipped,
      // so a mapped line that is missing from it did not go out. Only a
      // payload with no line list at all falls back to "everything shipped".
      const hasSkuList = shippedByCode.size > 0;
      const mapped = await tx.sku.findMany({
        where: { id: { in: order.items.map((item) => item.skuId) } },
        select: { id: true, qianyiSkuCode: true },
      });
      const codeById = new Map(mapped.map((row) => [row.id, row.qianyiSkuCode]));
      // What previous parcels (ours or Qianyi's) already boxed for each line.
      const shippedAlready = new Map<string, number>();
      for (const previous of order.shipments) {
        for (const item of previous.items ?? []) {
          shippedAlready.set(
            item.orderItemId,
            (shippedAlready.get(item.orderItemId) ?? 0) + item.quantity,
          );
        }
      }
      const lines: Array<{ orderItemId: string; quantity: number }> = [];
      const notes: string[] = [];
      const requirements = new Map<string, number>();

      for (const item of order.items) {
        const code = codeById.get(item.skuId) ?? null;
        const sent = code ? shippedByCode.get(code) : undefined;
        const announced = !hasSkuList
          ? item.quantity
          : sent === undefined
            ? 0
            : Math.min(sent, item.quantity);
        const remaining = Math.max(0, item.quantity - (shippedAlready.get(item.id) ?? 0));
        if (remaining === 0) {
          notes.push(`${item.skuCodeSnapshot}: already fully shipped, nothing consumed`);
          continue;
        }
        // A later parcel can never push a line past what was ordered.
        const quantity = Math.min(announced, remaining);
        if (quantity === 0) {
          notes.push(`${item.skuCodeSnapshot}: not shipped (ordered ${item.quantity})`);
          continue;
        }
        if (quantity !== item.quantity) {
          notes.push(`${item.skuCodeSnapshot}: ordered ${item.quantity}, shipped ${quantity}`);
        }
        lines.push({ orderItemId: item.id, quantity });
        requirements.set(item.skuId, (requirements.get(item.skuId) ?? 0) + quantity);
      }

      if (lines.length === 0) {
        notes.push('Qianyi reported a shipment with no matching line; nothing was consumed');
      }

      // 千易 在两个回调里用了不同的字段名（出库 `trackNumber`、物流 `trackingNumber`），
      // 而且 SHIPPING_INFO 常常先到，所以这里三处都兜住。
      const trackingNumber =
        payload.trackNumber ??
        payload.trackingNumber ??
        (await this.archivedTracking(tx, orderNumber));

      const warehouse = await this.resolveWarehouse(tx);
      const shipment = await tx.shipment.create({
        data: {
          orderId: order.id,
          warehouseId: warehouse.id,
          carrier: payload.carrier?.slice(0, 100) ?? 'SHIPDOC',
          trackingNumber,
          shippedAt: payload.shippingTime ? new Date(payload.shippingTime) : new Date(),
          qianyiOutboundNumber: payload.orderNumber ?? null,
          items: {
            create: lines.map((line) => ({
              orderItemId: line.orderItemId,
              quantity: line.quantity,
            })),
          },
        },
      });

      if (requirements.size > 0) {
        await this.inventory.consumeForOrder(tx, order.id, requirements);
      }

      if (notes.length > 0) {
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            noteType: 'WAREHOUSE',
            content: `Qianyi outbound ${payload.orderNumber ?? trackingNumber ?? ''}: ${notes.join('; ')}`.slice(0, 2000),
          },
        });
      }

      if (order.orderStatus !== 'SHIPPING' && order.orderStatus !== 'SIGNED') {
        await tx.order.update({
          where: { id: order.id },
          data: { orderStatus: 'SHIPPING' },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: 'SHIPPING',
            source: 'SYSTEM',
            comment: `Qianyi outbound ${payload.trackNumber ?? payload.orderNumber ?? ''}`.trim(),
          },
        });
      }

      await this.logistics.record(
        order.id,
        shipment.id,
        {
          normalizedStatus: 'SHIPPED',
          externalStatus: payload.status ?? null,
          externalEventId: payload.orderNumber ?? trackingNumber,
          eventTime: payload.shippingTime ? new Date(payload.shippingTime) : new Date(),
        },
        // The shipment was created in this very transaction and is not visible
        // on another connection until commit.
        tx,
      );

      // Tracking scans often arrive before the parcel record. They were archived
      // and could not attach to anything; now there is a shipment to hold them.
      for (const event of await this.archivedTrackingEvents(tx, orderNumber)) {
        const normalized = TRACKING_STATUS[event.status];
        if (!normalized || normalized === 'SHIPPED') continue;
        await this.logistics.record(
          order.id,
          shipment.id,
          {
            normalizedStatus: normalized,
            externalStatus: event.status,
            externalEventId: `${event.status}:${event.shippingTime ?? ''}`,
            eventTime: event.shippingTime ? new Date(event.shippingTime) : new Date(),
          },
          tx,
        );
      }
    });
  }

  /**
   * Which local Warehouse row books the shipment.
   *
   * 千易 fulfils from `PH-DAVAO-01`, which has no local counterpart by
   * default, so an unset pin keeps the historical "first active warehouse"
   * behaviour instead of inventing a row.
   */
  private async resolveWarehouse(tx: Prisma.TransactionClient) {
    const pinned = this.config.localWarehouseId;
    if (pinned) {
      const row = await tx.warehouse.findUnique({ where: { id: pinned } });
      if (row) return row;
      this.logger.warn(`qianyi local warehouse ${pinned} missing; using the default`);
    }
    return this.inventory.defaultWarehouse(tx);
  }

  /**
   * `PUSH_SALES_ORDER_SHIPPING_INFO` often arrives before the outbound. Its
   * number is archived, so the outbound can adopt it instead of leaving the
   * shipment without a tracking number.
   */
  private async archivedTracking(
    tx: Prisma.TransactionClient,
    orderNumber: string,
  ): Promise<string | null> {
    const events = tx.qianyiWebhookEvent;
    if (!events?.findMany) return null;
    const rows = await events.findMany({
      where: { serviceType: 'PUSH_SALES_ORDER_SHIPPING_INFO' },
      orderBy: { receivedAt: 'desc' },
      take: 20,
      select: { payload: true },
    });
    for (const row of rows) {
      const value = row.payload as {
        onlineOrderNumber?: string;
        trackingNumber?: string;
      };
      if (value.onlineOrderNumber === orderNumber && value.trackingNumber) {
        return value.trackingNumber;
      }
    }
    return null;
  }

  /** Tracking scans archived before the parcel record existed. */
  private async archivedTrackingEvents(
    tx: Prisma.TransactionClient,
    orderNumber: string,
  ): Promise<Array<{ status: string; shippingTime?: number }>> {
    const events = tx.qianyiWebhookEvent;
    if (!events?.findMany) return [];
    const rows = await events.findMany({
      where: { serviceType: 'PUSH_TRACKING_PACKAGE' },
      orderBy: { receivedAt: 'asc' },
      take: 50,
      select: { payload: true },
    });
    const out: Array<{ status: string; shippingTime?: number }> = [];
    for (const row of rows) {
      const value = row.payload as {
        onlineOrderNumber?: string;
        onlineOrderId?: string;
        status?: string;
        shippingTime?: number;
      };
      const matches =
        value.onlineOrderNumber === orderNumber || value.onlineOrderId === orderNumber;
      if (matches && value.status) {
        out.push({ status: value.status, shippingTime: value.shippingTime });
      }
    }
    return out;
  }

  private async applyShippingInfo(payload: OutboundPayload): Promise<void> {
    const orderNumber = payload.onlineOrderNumber;
    const trackingNumber = payload.trackingNumber ?? payload.trackNumber;
    if (!orderNumber || !trackingNumber) return;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        include: { shipments: true },
      });
      if (!order) return;
      const shipment = order.shipments[0];
      if (!shipment) {
        // The outbound has not arrived yet; the number must not be lost.
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            noteType: 'WAREHOUSE',
            content: `Qianyi tracking ${trackingNumber} (${payload.carrier ?? 'carrier'}) pending outbound`,
          },
        });
        return;
      }
      if (!shipment.trackingNumber) {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            trackingNumber,
            carrier: shipment.carrier || payload.carrier || 'SHIPDOC',
          },
        });
      }
    });
  }

  private async applyTracking(payload: OutboundPayload): Promise<void> {
    const orderNumber = payload.onlineOrderNumber;
    const status = payload.status ? TRACKING_STATUS[payload.status] : undefined;
    if (!orderNumber || !status) return;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        include: { shipments: true },
      });
      const shipment = order?.shipments[0];
      if (!order || !shipment) return;
      await this.logistics.record(
        order.id,
        shipment.id,
        {
          normalizedStatus: status,
          externalStatus: payload.status ?? null,
          externalEventId: `${payload.status}:${payload.shippingTime ?? ''}`,
        },
        tx,
      );
      if (status === 'SIGNED') {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: { signedAt: new Date(), qianyiStatus: payload.status ?? null },
        });
      }
    });
  }
}
