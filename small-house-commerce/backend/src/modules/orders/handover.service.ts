import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface HandoverItemInput {
  orderItemId: string;
  quantity: number;
}

export interface RecordHandoverInput {
  type: 'HANDED_OVER' | 'REJECTED' | 'WITHDRAWN';
  occurredAt?: Date | null;
  reason?: string | null;
  note?: string | null;
  items: HandoverItemInput[];
}

const DISPOSITION = {
  HANDED_OVER: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;

/**
 * Handover events (stage 1A).
 *
 * "The goods went to the warehouse" is a fact, not a status: it has a real
 * time, a real operator, the order lines and the quantities that moved, and
 * a reason whenever the warehouse refused or the customer withdrew. The
 * work queues are derived from these events, so a partial handover stays
 * visible instead of disappearing into a status column.
 *
 * This is deliberately not a warehouse-management system: no bins, no
 * picking, no labels.
 */
@Injectable()
export class OrderHandoverService {
  constructor(private readonly prisma: PrismaService) {}

  async record(orderId: string, operatorId: string, input: RecordHandoverInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { select: { id: true, skuCodeSnapshot: true, quantity: true } } },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.orderStatus !== 'CONFIRMED') {
        throw new BadRequestException(
          `Only confirmed orders can be handed over (current: ${order.orderStatus})`,
        );
      }

      if ((input.type === 'REJECTED' || input.type === 'WITHDRAWN') && !input.reason) {
        throw new BadRequestException(
          input.type === 'REJECTED' ? '仓库拒收必须写明原因' : '撤回必须写明原因',
        );
      }
      if (!input.items.length) {
        throw new BadRequestException('必须写明交仓的订单行与数量');
      }
      const alreadyHandedOver = await this.handedOverMap(tx, orderId);
      // The cached column can lag behind orders recorded before it existed;
      // the events below are what actually proves the goods arrived.
      const allLinesReceived = order.items.every(
        (line) => (alreadyHandedOver.get(line.id) ?? 0) >= line.quantity,
      );
      if (input.type === 'REJECTED' && (order.handoverCompletedAt || allLinesReceived)) {
        throw new BadRequestException(
          'All goods are already at the warehouse; record a withdrawal or an after-sales case instead',
        );
      }

      const lineById = new Map(order.items.map((i) => [i.id, i]));

      const items = input.items.map((entry) => {
        const line = lineById.get(entry.orderItemId);
        if (!line) {
          throw new BadRequestException(`订单行 ${entry.orderItemId} 不属于该订单`);
        }
        if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
          throw new BadRequestException('交仓数量必须是大于 0 的整数');
        }
        if (entry.quantity > line.quantity) {
          throw new BadRequestException(
            `交仓数量 ${entry.quantity} 超过订单行数量 ${line.quantity}`,
          );
        }
        if (input.type === 'HANDED_OVER') {
          const done = alreadyHandedOver.get(entry.orderItemId) ?? 0;
          if (done + entry.quantity > line.quantity) {
            throw new BadRequestException(
              `订单行 ${entry.orderItemId} 交仓数量超出订单数量（已交 ${done}，共 ${line.quantity}）`,
            );
          }
        }
        return {
          orderItemId: entry.orderItemId,
          quantity: entry.quantity,
          skuCodeSnapshot: line.skuCodeSnapshot,
        };
      });

      const event = await tx.orderHandoverEvent.create({
        data: {
          orderId,
          type: input.type,
          disposition: DISPOSITION[input.type],
          occurredAt: input.occurredAt ?? new Date(),
          operatorId,
          reason: input.reason ?? null,
          note: input.note ?? null,
          items: items as unknown as object,
        },
      });

      if (input.type === 'HANDED_OVER') {
        const totals = new Map(alreadyHandedOver);
        for (const item of items) {
          totals.set(item.orderItemId, (totals.get(item.orderItemId) ?? 0) + item.quantity);
        }
        const complete = order.items.every(
          (line) => (totals.get(line.id) ?? 0) >= line.quantity,
        );
        if (complete !== Boolean(order.handoverCompletedAt)) {
          await tx.order.update({
            where: { id: orderId },
            data: { handoverCompletedAt: complete ? new Date() : null },
          });
        }
      }

      if (input.type === 'REJECTED') {
        // The goods did not enter the warehouse: send the order back to the
        // review queue so a person decides what happens next.
        await tx.order.update({
          where: { id: orderId },
          data: {
            orderStatus: 'PENDING',
            confirmationStatus: 'UNCONFIRMED',
            handoverCompletedAt: null,
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: 'PENDING',
            source: 'ADMIN',
            operatorId,
            comment: `仓库拒收：${input.reason}`,
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            statusDomain: 'CONFIRMATION_STATUS',
            oldStatus: order.confirmationStatus,
            newStatus: 'UNCONFIRMED',
            source: 'ADMIN',
            operatorId,
            comment: '仓库拒收后重新核实',
          },
        });
      }

      if (input.type === 'WITHDRAWN') {
        // The goods are already with the warehouse: cancelling must not put
        // them back on sale. This path deliberately does not touch inventory.
        await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: 'CANCELLED', handoverCompletedAt: null },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: 'CANCELLED',
            source: 'ADMIN',
            operatorId,
            comment: input.reason ?? null,
          },
        });
      }

      return event;
    });
  }

  /** How much of every order line the warehouse has accepted so far. */
  private async handedOverMap(
    tx: Pick<Prisma.TransactionClient, 'orderHandoverEvent'>,
    orderId: string,
  ): Promise<Map<string, number>> {
    const events = await tx.orderHandoverEvent.findMany({ where: { orderId } });
    const totals = new Map<string, number>();
    for (const event of events) {
      if (event.type !== 'HANDED_OVER') continue;
      for (const item of (event.items as { orderItemId: string; quantity: number }[]) ?? []) {
        totals.set(item.orderItemId, (totals.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }
    return totals;
  }

  /**
   * The handover state of an order: what the warehouse has, what is still
   * outstanding, and whether anything was refused or withdrawn.
   */
  async summary(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { id: true, skuCodeSnapshot: true, quantity: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const events = await this.prisma.orderHandoverEvent.findMany({
      where: { orderId },
      orderBy: { occurredAt: 'desc' },
    });

    const handed = new Map<string, number>();
    let rejected = 0;
    let withdrawn = 0;
    for (const event of events) {
      if (event.type === 'REJECTED') rejected += 1;
      if (event.type === 'WITHDRAWN') withdrawn += 1;
      if (event.type !== 'HANDED_OVER') continue;
      for (const item of (event.items as { orderItemId: string; quantity: number }[]) ?? []) {
        handed.set(item.orderItemId, (handed.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }

    const handedOver = order.items
      .filter((line) => (handed.get(line.id) ?? 0) > 0)
      .map((line) => ({
        orderItemId: line.id,
        quantity: handed.get(line.id)!,
        skuCodeSnapshot: line.skuCodeSnapshot,
      }));
    const outstanding = order.items
      .filter((line) => (handed.get(line.id) ?? 0) < line.quantity)
      .map((line) => ({
        orderItemId: line.id,
        quantity: line.quantity - (handed.get(line.id) ?? 0),
        skuCodeSnapshot: line.skuCodeSnapshot,
      }));

    return {
      handedOver,
      outstanding,
      rejected,
      withdrawn,
      complete: outstanding.length === 0,
      events,
    };
  }
}
