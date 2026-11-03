import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { orderStatusAfterSign, quantityByLine, type ShipmentSnapshot } from './return-outcome.js';

// The caller holds the order row lock, including when signing from a webhook.
export async function signShipmentWithin(
  tx: Prisma.TransactionClient,
  orderId: string,
  shipmentId: string,
  audit: { source: 'ADMIN' | 'SYSTEM'; operatorId?: string; at?: Date },
) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, shipments: { include: { items: true } } } });
  if (!order) throw new NotFoundException('Order not found');
  const shipment = order.shipments.find(box => box.id === shipmentId);
  if (!shipment) throw new NotFoundException('Shipment not found on this order');
  if (shipment.status === 'SIGNED') throw new BadRequestException('Shipment is already signed');
  if (shipment.status === 'RETURNED' || shipment.status === 'PARTIALLY_RETURNED') {
    throw new BadRequestException(`Shipment was already returned; its goods cannot be signed (current: ${shipment.status})`);
  }
  if (order.orderStatus !== 'SHIPPING') throw new BadRequestException(`Order is ${order.orderStatus}; only SHIPPING orders can be signed`);
  const accepted = await tx.returnAcceptanceItem.findMany({
    where: { acceptance: { orderId, shipmentId } }, select: { orderItemId: true, quantityGood: true, quantityDamaged: true },
  });
  const hasReturnedUnits = accepted.some(item => item.quantityGood + item.quantityDamaged > 0);
  const shipmentStatus = hasReturnedUnits ? 'PARTIALLY_RETURNED' : 'SIGNED';
  await tx.shipment.update({ where: { id: shipmentId }, data: { status: shipmentStatus, signedAt: audit.at ?? new Date() } });
  const shipments: ShipmentSnapshot[] = order.shipments.map(box => ({ id: box.id, status: box.id === shipmentId ? shipmentStatus : box.status, items: box.items }));
  const shippedByLine = new Map<string, number>();
  for (const box of shipments) for (const [id, quantity] of quantityByLine(box.items)) shippedByLine.set(id, (shippedByLine.get(id) ?? 0) + quantity);
  const fullyShipped = order.items.every(line => (shippedByLine.get(line.id) ?? 0) >= line.quantity);
  const orderStatus = orderStatusAfterSign({ lines: order.items, shipments, fullyShipped });
  if (orderStatus !== order.orderStatus) {
    await tx.order.update({ where: { id: orderId }, data: { orderStatus } });
    await tx.orderStatusHistory.create({ data: { orderId, statusDomain: 'ORDER_STATUS', oldStatus: order.orderStatus,
      newStatus: orderStatus, source: audit.source, operatorId: audit.operatorId,
      comment: hasReturnedUnits ? 'Remaining goods signed; some units were returned' : 'All shipments signed' } });
  }
  await tx.orderNote.create({ data: { orderId, userId: audit.operatorId, noteType: 'WAREHOUSE',
    content: `Shipment signed (${shipment.carrier}${shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''})` } });
  return { shipmentId, orderStatus, shipmentStatus };
}
