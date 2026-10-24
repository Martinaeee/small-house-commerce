import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { requirementsFromBundleSnapshot } from '../inventory/bundle-inventory.js';
import { readBundleSnapshot } from './order-item-snapshot.js';
import {
  isBoxFullyReturned,
  orderStatusAfterAcceptance,
  quantityByLine,
  type ShipmentSnapshot,
} from './return-outcome.js';

export interface ReturnLineInput {
  orderItemId: string;
  quantityGood: number;
  quantityDamaged: number;
  conditionNote?: string | null;
}

export interface AcceptReturnInput {
  shipmentId: string;
  reason?: string | null;
  items: ReturnLineInput[];
}

/**
 * RTO / return acceptance (stage 3B).
 *
 * The warehouse counts what physically came back, box by box. Good units go
 * back on sale; damaged units are recorded and never re-enter sellable stock.
 * Good units are restored from the line's recorded Bundle snapshot (the
 * physical components that left), not from today's bundle definition.
 *
 * A return is always tied to the shipment it arrived in and is capped by what
 * that box shipped, so another box carrying the same line cannot inflate the
 * limit. A fully returned box never gets signed; once no box is still out, the
 * order closes as RETURNED (nothing delivered) or PARTIALLY_RETURNED. Payment
 * and COD settlement are out of scope here.
 */
@Injectable()
export class ReturnAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  async accept(orderId: string, operatorId: string, input: AcceptReturnInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          shipments: { include: { items: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.orderStatus !== 'SHIPPING') {
        throw new BadRequestException(
          `Only shipped orders can receive a return (current: ${order.orderStatus})`,
        );
      }
      if (!input.items.length) {
        throw new BadRequestException('至少登记一行退货');
      }

      const shipment = order.shipments.find((box) => box.id === input.shipmentId);
      if (!shipment) {
        throw new NotFoundException('Shipment not found on this order');
      }
      if (shipment.status !== 'SHIPPING') {
        throw new BadRequestException(
          `Only a shipping shipment can receive a return (current: ${shipment.status})`,
        );
      }

      const shippedInBox = quantityByLine(shipment.items);

      const previous = await tx.returnAcceptanceItem.findMany({
        where: { acceptance: { orderId } },
        select: {
          orderItemId: true,
          quantityGood: true,
          quantityDamaged: true,
          acceptance: { select: { shipmentId: true } },
        },
      });
      const acceptedInBox = new Map<string, number>();
      const acceptedAll = new Map<string, number>();
      const add = (map: Map<string, number>, lineId: string, quantity: number) =>
        map.set(lineId, (map.get(lineId) ?? 0) + quantity);
      for (const item of previous) {
        const quantity = item.quantityGood + item.quantityDamaged;
        add(acceptedAll, item.orderItemId, quantity);
        if (item.acceptance.shipmentId === shipment.id) {
          add(acceptedInBox, item.orderItemId, quantity);
        }
      }

      const lineById = new Map(order.items.map((line) => [line.id, line]));
      const seen = new Set<string>();
      const items = input.items.map((entry) => {
        if (seen.has(entry.orderItemId)) {
          throw new BadRequestException(`订单行 ${entry.orderItemId} 重复登记`);
        }
        seen.add(entry.orderItemId);
        const line = lineById.get(entry.orderItemId);
        if (!line) {
          throw new BadRequestException(`订单行 ${entry.orderItemId} 不属于该订单`);
        }
        if (
          !Number.isInteger(entry.quantityGood) ||
          !Number.isInteger(entry.quantityDamaged) ||
          entry.quantityGood < 0 ||
          entry.quantityDamaged < 0 ||
          entry.quantityGood + entry.quantityDamaged < 1
        ) {
          throw new BadRequestException('退货数量必须是非负整数，且至少退回 1 件');
        }
        const shippedQuantity = shippedInBox.get(line.id) ?? 0;
        const acceptedBefore = acceptedInBox.get(line.id) ?? 0;
        if (entry.quantityGood + entry.quantityDamaged > shippedQuantity - acceptedBefore) {
          throw new BadRequestException(
            `订单行 ${entry.orderItemId} 退货数量超出本发货单已发数量（本箱已发 ${shippedQuantity}，已退 ${acceptedBefore}）`,
          );
        }
        return {
          orderItemId: line.id,
          quantityGood: entry.quantityGood,
          quantityDamaged: entry.quantityDamaged,
          conditionNote: entry.conditionNote ?? null,
        };
      });

      const acceptance = await tx.returnAcceptance.create({
        data: {
          orderId,
          shipmentId: shipment.id,
          reason: input.reason ?? null,
          receivedBy: operatorId,
          items: { create: items },
        },
        include: { items: true },
      });

      for (const entry of items) {
        if (entry.quantityGood === 0) continue;
        const line = lineById.get(entry.orderItemId)!;
        const warehouseId = shipment.warehouseId;
        const snapshot =
          line.bundleSnapshot == null ? null : readBundleSnapshot(line.bundleSnapshot);
        if (line.bundleSnapshot != null && snapshot === null) {
          throw new BadRequestException(
            'This Bundle line snapshot is unreadable; restore its recorded definition before continuing.',
          );
        }
        const requirements = snapshot
          ? requirementsFromBundleSnapshot(snapshot, entry.quantityGood)
          : [{ skuId: line.skuId, quantity: entry.quantityGood }];
        for (const requirement of requirements) {
          await tx.inventory.update({
            where: { skuId_warehouseId: { skuId: requirement.skuId, warehouseId } },
            data: { onHand: { increment: requirement.quantity } },
          });
          await tx.inventoryMovement.create({
            data: {
              skuId: requirement.skuId,
              warehouseId,
              movementType: 'RETURN_RESTOCK',
              quantity: requirement.quantity,
              referenceType: 'RETURN_ACCEPTANCE',
              referenceId: acceptance.id,
              operatorId,
              reason: input.reason ?? null,
            },
          });
        }
      }

      for (const entry of items) {
        const quantity = entry.quantityGood + entry.quantityDamaged;
        add(acceptedInBox, entry.orderItemId, quantity);
        add(acceptedAll, entry.orderItemId, quantity);
      }

      const boxFullyReturned = isBoxFullyReturned(shipment, acceptedInBox);
      if (boxFullyReturned) {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: { status: 'RETURNED' },
        });
      }

      const shipments: ShipmentSnapshot[] = order.shipments.map((box) => ({
        id: box.id,
        status:
          box.id === shipment.id && boxFullyReturned ? 'RETURNED' : box.status,
        items: box.items,
      }));
      const nextStatus = orderStatusAfterAcceptance({
        lines: order.items,
        shipments,
        acceptedAll,
      });
      if (nextStatus && nextStatus !== order.orderStatus) {
        await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: nextStatus },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: nextStatus,
            source: 'ADMIN',
            operatorId,
            comment:
              nextStatus === 'RETURNED'
                ? 'All shipped units returned to the warehouse'
                : 'Return accepted; the rest of the order was delivered',
          },
        });
      }

      return acceptance;
    });
  }

  list(orderId: string) {
    return this.prisma.returnAcceptance.findMany({
      where: { orderId },
      include: { items: true },
      orderBy: { receivedAt: 'desc' },
    });
  }
}
