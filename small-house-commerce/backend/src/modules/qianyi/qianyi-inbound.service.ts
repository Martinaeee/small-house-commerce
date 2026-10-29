import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { requirementsFromBundleSnapshot } from '../inventory/bundle-inventory.js';
import { LogisticsEventService, type LogisticsStatus } from '../orders/logistics-event.service.js';
import { readBundleSnapshot } from '../orders/order-item-snapshot.js';
import { signShipmentWithin } from '../orders/sign-shipment.js';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';
import { qianyiCarrier, qianyiEventKey, qianyiEventTime, qianyiField } from './qianyi-event.js';

const TRACKING_STATUS: Record<string, LogisticsStatus> = {
  CREATED: 'SHIPPED', AVAILABLE_FOR_PICKUP: 'SHIPPED', IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', DELIVERED: 'SIGNED', NOT_FOUND: 'FAILED_DELIVERY', CANCEL: 'RETURNING',
};
const ORDER_INCLUDE = { items: true, shipments: { include: { items: true } }, riskFlags: true } satisfies Prisma.OrderInclude;
type Order = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type Payload = Record<string, unknown>;

@Injectable()
export class QianyiInboundService {
  private readonly config: QianyiConfig;

  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService,
    private readonly logistics: LogisticsEventService, config: ConfigService) {
    this.config = readQianyiConfig(config);
  }

  async handle(serviceType: string, payload: Payload, client?: Prisma.TransactionClient): Promise<void> {
    if (!this.config.enabled) return;
    const apply = async (tx: Prisma.TransactionClient) => {
      if (serviceType === 'PUSH_ODO_ORDER' && payload.status === 'SHIPPED') await this.outbound(tx, payload);
      if (serviceType === 'PUSH_SALES_ORDER_SHIPPING_INFO') await this.shippingInfo(tx, payload);
      if (serviceType === 'PUSH_TRACKING_PACKAGE') await this.tracking(tx, payload);
      if (serviceType === 'PUSH_RETURN_ORDER_INFO') await this.returnNotice(tx, payload);
    };
    if (client) await apply(client);
    else await this.prisma.$transaction(apply, { timeout: 20_000, maxWait: 10_000 });
  }

  private async lockedOrder(tx: Prisma.TransactionClient, payload: Payload): Promise<Order> {
    const online = qianyiField(payload, 'onlineOrderNumber');
    const alternate = qianyiField(payload, 'onlineOrderId');
    if (online && alternate && online !== alternate) throw new BadRequestException('Conflicting Qianyi order references');
    const reference = online || alternate;
    if (!reference) throw new BadRequestException('Missing Qianyi online order reference');
    await tx.$queryRaw`SELECT id FROM orders WHERE order_number=${reference} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { orderNumber: reference }, include: ORDER_INCLUDE });
    if (!order) throw new BadRequestException('Unknown Qianyi online order');
    return order;
  }

  /**
   * Returns are not modelled yet. Recording the callback as a note keeps it
   * visible to an operator instead of silently acknowledging and dropping it;
   * stock, refunds and order status stay untouched until the rules are agreed.
   */
  private async returnNotice(tx: Prisma.TransactionClient, payload: Payload): Promise<void> {
    const reference = qianyiField(payload, 'onlineOrderNumber', 'onlineOrderId');
    if (!reference) return;
    const order = await tx.order.findUnique({ where: { orderNumber: reference }, select: { id: true } });
    if (!order) return;
    const returnNumber = qianyiField(payload, 'returnOrderNumber', 'orderNumber').slice(0, 64) || 'unknown';
    await tx.orderNote.create({ data: { orderId: order.id, noteType: 'SYSTEM',
      content: `Qianyi return callback ${returnNumber} received; process the return in the workbench.`.slice(0, 2000) } });
  }

  private async relatedEvents(tx: Prisma.TransactionClient, order: Order) {    return tx.qianyiWebhookEvent.findMany({ where: {
      signValid: true, serviceType: { in: ['PUSH_SALES_ORDER_SHIPPING_INFO', 'PUSH_TRACKING_PACKAGE'] },
      OR: [{ payload: { path: ['onlineOrderNumber'], equals: order.orderNumber } },
        { payload: { path: ['onlineOrderId'], equals: order.orderNumber } }],
    }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
  }

  private async outbound(tx: Prisma.TransactionClient, payload: Payload): Promise<void> {
    const order = await this.lockedOrder(tx, payload);
    const number = qianyiField(payload, 'orderNumber');
    if (!number || number.length > 64) throw new BadRequestException('Missing or invalid Qianyi outbound number');
    const existing = await tx.shipment.findUnique({ where: { qianyiOutboundNumber: number } });
    if (existing) {
      if (existing.orderId !== order.id) throw new BadRequestException('Qianyi outbound already belongs to another order');
      return;
    }
    if (!['CONFIRMED', 'SHIPPING'].includes(order.orderStatus) || order.confirmationStatus !== 'CONFIRMED') {
      throw new BadRequestException('Qianyi outbound requires a confirmed, open order');
    }
    if (order.riskFlags.some(flag => !flag.resolved && ['CUSTOMER_RECHECK', 'POSSIBLE_DUPLICATE'].includes(flag.flagType))) {
      throw new BadRequestException('Unresolved risk flag blocks Qianyi outbound');
    }
    const warehouse = this.config.localWarehouseId
      ? await tx.warehouse.findUnique({ where: { id: this.config.localWarehouseId } }) : null;
    if (!warehouse || warehouse.status !== 'ACTIVE' || warehouse.country !== 'PH') {
      throw new BadRequestException('Qianyi requires an explicit active local PH warehouse');
    }
    const push = await tx.qianyiSyncJob.findUnique({ where: { orderId_kind: { orderId: order.id, kind: 'PUSH_ORDER' } } });
    const request = push?.requestPayload as Record<string, unknown> | undefined;
    const frozen = request?._skuMapping;
    if (!push || push.attempts < 1 || !frozen || typeof frozen !== 'object' || Array.isArray(frozen)) {
      throw new BadRequestException('Qianyi outbound has no frozen sent SKU mapping');
    }
    const mapping = frozen as Record<string, unknown>;
    const skus = await tx.sku.findMany({ where: { id: { in: order.items.map(item => item.skuId) } }, select: { id: true, isBundle: true } });
    const virtual = new Set(skus.filter(sku => sku.isBundle).map(sku => sku.id));
    const skuByCode = new Map<string, string>();
    for (const item of order.items) {
      const code = qianyiField(mapping, item.id);
      if (!code || (skuByCode.has(code) && skuByCode.get(code) !== item.skuId)) {
        throw new BadRequestException('Missing or ambiguous frozen Qianyi SKU mapping');
      }
      skuByCode.set(code, item.skuId);
    }
    if (!Array.isArray(payload.skuList) || payload.skuList.length === 0) throw new BadRequestException('Qianyi outbound must list actual shipped quantities');
    const announced = new Map<string, number>();
    for (const raw of payload.skuList) {
      if (!raw || typeof raw !== 'object') throw new BadRequestException('Invalid Qianyi outbound line');
      const line = raw as Record<string, unknown>;
      const code = qianyiField(line, 'sku');
      if (!skuByCode.has(code) || !Number.isSafeInteger(line.quantity) || Number(line.quantity) <= 0) {
        throw new BadRequestException('Unknown SKU or invalid Qianyi shipped quantity');
      }
      announced.set(code, (announced.get(code) ?? 0) + Number(line.quantity));
    }
    const archived = await this.relatedEvents(tx, order);
    let trackingNumber = qianyiField(payload, 'trackingNumber', 'trackNumber');
    if (!trackingNumber) {
      const numbers = [...new Set(archived.map(event => qianyiField(event.payload as Payload, 'trackingNumber', 'trackNumber')).filter(Boolean))];
      if (numbers.length !== 1) throw new BadRequestException('Qianyi outbound needs an unambiguous tracking number');
      trackingNumber = numbers[0];
    }
    let carrier = qianyiCarrier(null, payload.carrier);
    for (const event of archived) {
      const data = event.payload as Payload;
      if (qianyiField(data, 'trackingNumber', 'trackNumber') === trackingNumber) carrier = qianyiCarrier(carrier, data.carrier);
    }
    const manual = order.shipments.filter(box => box.trackingNumber === trackingNumber);
    if (manual.length > 1) throw new BadRequestException('Ambiguous existing shipment waybill');
    if (manual.length === 1) {
      const box = manual[0];
      if (box.qianyiOutboundNumber) throw new BadRequestException('Waybill already bound to a different outbound');
      const boxed = new Map<string, number>();
      for (const item of box.items) {
        const code = qianyiField(mapping, item.orderItemId);
        boxed.set(code, (boxed.get(code) ?? 0) + item.quantity);
      }
      if (boxed.size !== announced.size || [...announced].some(([code, quantity]) => boxed.get(code) !== quantity)) {
        throw new BadRequestException('Qianyi quantities conflict with the existing manual shipment');
      }
      await tx.shipment.update({ where: { id: box.id }, data: { qianyiOutboundNumber: number, carrier: qianyiCarrier(box.carrier, carrier) } });
    } else {
      const already = new Map<string, number>();
      for (const box of order.shipments) for (const line of box.items) already.set(line.orderItemId, (already.get(line.orderItemId) ?? 0) + line.quantity);
      const lines: Array<{ orderItemId: string; quantity: number }> = [];
      const requirements = new Map<string, number>();
      for (const item of order.items) {
        const code = qianyiField(mapping, item.id);
        const quantity = Math.min(announced.get(code) ?? 0, Math.max(0, item.quantity - (already.get(item.id) ?? 0)));
        if (quantity === 0) continue;
        announced.set(code, announced.get(code)! - quantity);
        lines.push({ orderItemId: item.id, quantity });
        const snapshot = readBundleSnapshot(item.bundleSnapshot);
        if ((item.bundleSnapshot != null && !snapshot) || (virtual.has(item.skuId) && !snapshot) ||
            (snapshot && (snapshot.bundleSkuId !== item.skuId || snapshot.components.some(c => c.totalQuantity !== c.quantity * item.quantity)))) {
          throw new BadRequestException('Invalid frozen Bundle snapshot');
        }
        const physical = snapshot ? requirementsFromBundleSnapshot(snapshot, quantity) : [{ skuId: item.skuId, quantity }];
        for (const line of physical) requirements.set(line.skuId, (requirements.get(line.skuId) ?? 0) + line.quantity);
      }
      if (lines.length === 0 || [...announced.values()].some(quantity => quantity > 0)) throw new BadRequestException('Qianyi outbound exceeds the unshipped order quantities');
      const reservations = await tx.inventoryReservation.findMany({ where: { orderId: order.id, status: 'ACTIVE', skuId: { in: [...requirements.keys()] } } });
      if (reservations.some(reservation => reservation.warehouseId !== warehouse.id)) throw new BadRequestException('Qianyi warehouse differs from reserved inventory');
      const shipment = await tx.shipment.create({ data: { orderId: order.id, warehouseId: warehouse.id, carrier, trackingNumber,
        qianyiOutboundNumber: number, shippedAt: qianyiEventTime(payload) ?? new Date(), items: { create: lines } } });
      await this.inventory.consumeForOrder(tx, order.id, new Map([...requirements].sort(([a], [b]) => a.localeCompare(b))));
      if (order.orderStatus !== 'SHIPPING') {
        await tx.order.update({ where: { id: order.id }, data: { orderStatus: 'SHIPPING' } });
        await tx.orderStatusHistory.create({ data: { orderId: order.id, statusDomain: 'ORDER_STATUS', oldStatus: order.orderStatus,
          newStatus: 'SHIPPING', source: 'SYSTEM', comment: `Qianyi outbound ${number}` } });
      }
      await this.logistics.record(order.id, shipment.id, { normalizedStatus: 'SHIPPED', externalStatus: 'SHIPPED',
        externalEventId: qianyiEventKey('PUSH_ODO_ORDER', payload), eventTime: qianyiEventTime(payload),
        province: qianyiField(payload, 'province') || null, city: qianyiField(payload, 'city') || null }, tx);
    }
    for (const event of archived) {
      if (event.serviceType === 'PUSH_SALES_ORDER_SHIPPING_INFO') await this.shippingInfo(tx, event.payload as Payload);
      if (event.serviceType === 'PUSH_TRACKING_PACKAGE') await this.tracking(tx, event.payload as Payload);
    }
  }

  private parcel(order: Order, payload: Payload) {
    const trackingNumber = qianyiField(payload, 'trackingNumber', 'trackNumber');
    const outbound = qianyiField(payload, 'outboundNumber', 'outboundOrderNumber');
    const matches = order.shipments.filter(box => (trackingNumber && box.trackingNumber === trackingNumber) || (outbound && box.qianyiOutboundNumber === outbound));
    if (matches.length > 1) throw new BadRequestException('Ambiguous Qianyi shipment identity');
    if (matches.length === 1) return matches[0];
    if (!trackingNumber && !outbound && order.shipments.length > 1) {
      throw new BadRequestException('Qianyi callback does not identify which parcel it belongs to');
    }
    if (trackingNumber && order.shipments.length === 1 && !order.shipments[0].trackingNumber) return order.shipments[0];
    return null;
  }

  private async shippingInfo(tx: Prisma.TransactionClient, payload: Payload): Promise<void> {
    const order = await this.lockedOrder(tx, payload);
    const parcel = this.parcel(order, payload);
    if (!parcel) return;
    const trackingNumber = qianyiField(payload, 'trackingNumber', 'trackNumber');
    const carrier = qianyiCarrier(parcel.carrier, payload.carrier);
    if (carrier !== parcel.carrier || (!parcel.trackingNumber && trackingNumber)) {
      await tx.shipment.update({ where: { id: parcel.id }, data: { carrier, trackingNumber: parcel.trackingNumber || trackingNumber || null } });
    }
  }

  private async tracking(tx: Prisma.TransactionClient, payload: Payload): Promise<void> {
    const externalStatus = qianyiField(payload, 'status');
    const status = TRACKING_STATUS[externalStatus];
    if (!status) return;
    const order = await this.lockedOrder(tx, payload);
    const parcel = this.parcel(order, payload);
    if (!parcel) return;
    const carrier = qianyiCarrier(parcel.carrier, payload.carrier);
    if (carrier !== parcel.carrier) await tx.shipment.update({ where: { id: parcel.id }, data: { carrier } });
    const at = qianyiEventTime(payload);
    await this.logistics.record(order.id, parcel.id, { normalizedStatus: status, externalStatus,
      externalEventId: qianyiEventKey('PUSH_TRACKING_PACKAGE', payload), eventTime: at,
      city: qianyiField(payload, 'city') || null, province: qianyiField(payload, 'province') || null }, tx);
    if (status === 'SIGNED' && parcel.status !== 'SIGNED') {
      await signShipmentWithin(tx, order.id, parcel.id, { source: 'SYSTEM', at: at ?? new Date() });
      await tx.shipment.update({ where: { id: parcel.id }, data: { qianyiStatus: externalStatus } });
    }
  }
}
