import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Inventory operations shared by orders (reserve/release) and the admin
 * adjustment endpoint. available is always computed: on_hand - reserved.
 */
export interface SkuStock {
  onHand: number;
  reserved: number;
  available: number;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * on_hand / reserved / available per SKU, across all warehouses. SKUs with no
   * inventory row are absent (callers treat a miss as zero) — the same contract
   * availableBySku has always had.
   */
  async stockBySku(skuIds: string[]): Promise<Map<string, SkuStock>> {
    const result = new Map<string, SkuStock>();
    if (skuIds.length === 0) return result;

    const grouped = await this.prisma.inventory.groupBy({
      by: ['skuId'],
      where: { skuId: { in: skuIds } },
      _sum: { onHand: true, reserved: true },
    });

    for (const row of grouped) {
      const onHand = row._sum.onHand ?? 0;
      const reserved = row._sum.reserved ?? 0;
      result.set(row.skuId, { onHand, reserved, available: onHand - reserved });
    }

    return result;
  }

  /** available per SKU across all warehouses. */
  async availableBySku(skuIds: string[]): Promise<Map<string, number>> {
    const stock = await this.stockBySku(skuIds);
    return new Map([...stock].map(([skuId, row]) => [skuId, row.available]));
  }

  /**
   * Reserves stock for an order (DATABASE.md §30: reserve without touching
   * on-hand). Caller is responsible for the surrounding transaction.
   */
  async reserveWithin(
    tx: Prisma.TransactionClient,
    skuId: string,
    warehouseId: string,
    quantity: number,
    orderId: string,
  ): Promise<void> {
    const inventory = await tx.inventory.findUnique({
      where: { skuId_warehouseId: { skuId, warehouseId } },
    });

    if (!inventory) {
      throw new BadRequestException('SKU has no inventory record');
    }

    const available = inventory.onHand - inventory.reserved;
    if (available < quantity) {
      throw new BadRequestException(`Insufficient stock: available ${available}, requested ${quantity}`);
    }

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { reserved: { increment: quantity } },
    });
    await tx.inventoryReservation.create({
      data: { orderId, skuId, warehouseId, quantity },
    });
    await tx.inventoryMovement.create({
      data: {
        skuId,
        warehouseId,
        movementType: 'ORDER_RESERVED',
        quantity,
        referenceType: 'ORDER',
        referenceId: orderId,
      },
    });
  }

  /**
   * Releases every active reservation of an order (DATABASE.md §31: cancel /
   * deny release remaining reservations).
   */
  async releaseForOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });

    for (const reservation of reservations) {
      await tx.inventory.update({
        where: { skuId_warehouseId: { skuId: reservation.skuId, warehouseId: reservation.warehouseId } },
        data: { reserved: { decrement: reservation.quantity } },
      });
      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
      });
      await tx.inventoryMovement.create({
        data: {
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          movementType: 'RESERVATION_RELEASED',
          quantity: reservation.quantity,
          referenceType: 'ORDER',
          referenceId: orderId,
        },
      });
    }
  }

  /**
   * Manual stock adjustment (DATABASE.md §33 MANUAL_ADJUSTMENT). A negative
   * quantity reduces on-hand; on-hand may not go below zero.
   */
  async adjust(
    skuId: string,
    quantity: number,
    reason: string | undefined,
    operatorId: string | undefined,
  ) {
    if (quantity === 0) {
      throw new BadRequestException('Adjustment quantity must not be zero');
    }

    const warehouse = await this.defaultWarehouse();
    let inventory = await this.prisma.inventory.findUnique({
      where: { skuId_warehouseId: { skuId, warehouseId: warehouse.id } },
    });

    // First adjustment for a SKU creates the record (stock arrives at the
    // warehouse), so a bare on-hand row never needs manual pre-seeding.
    if (!inventory) {
      if (quantity < 0) {
        throw new BadRequestException('Cannot open a negative inventory record');
      }
      await this.prisma.inventory.create({
        data: { skuId, warehouseId: warehouse.id, onHand: quantity, reserved: 0 },
      });
      await this.prisma.inventoryMovement.create({
        data: {
          skuId,
          warehouseId: warehouse.id,
          movementType: 'MANUAL_ADJUSTMENT',
          quantity,
          operatorId,
          reason: reason ?? 'initial stock',
        },
      });
      inventory = await this.prisma.inventory.findUniqueOrThrow({
        where: { skuId_warehouseId: { skuId, warehouseId: warehouse.id } },
      });
      return { onHand: inventory.onHand, reserved: inventory.reserved, available: inventory.onHand - inventory.reserved };
    }

    if (quantity < 0 && inventory.onHand + quantity < 0) {
      throw new BadRequestException('Adjustment would make on-hand negative');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id: inventory.id },
        data: { onHand: { increment: quantity } },
      });
      await tx.inventoryMovement.create({
        data: {
          skuId,
          warehouseId: warehouse.id,
          movementType: 'MANUAL_ADJUSTMENT',
          quantity,
          operatorId,
          reason,
        },
      });
    });

    const updated = await this.prisma.inventory.findUniqueOrThrow({
      where: { id: inventory.id },
    });
    return { onHand: updated.onHand, reserved: updated.reserved, available: updated.onHand - updated.reserved };
  }

  /**
   * Absolute stock set, used by the product form (the admin types the number
   * they want, not a delta). Writes the same MANUAL_ADJUSTMENT movement an
   * adjustment does, so the audit trail stays complete, but takes a target so
   * the write is idempotent regardless of how stale the form's copy is.
   */
  async setOnHand(
    skuId: string,
    onHand: number,
    reason: string | undefined,
    operatorId: string | undefined,
  ) {
    if (!Number.isInteger(onHand) || onHand < 0) {
      throw new BadRequestException('Stock must be a whole number of 0 or more');
    }

    const warehouse = await this.defaultWarehouse();
    const inventory = await this.prisma.inventory.findUnique({
      where: { skuId_warehouseId: { skuId, warehouseId: warehouse.id } },
    });

    const current = inventory?.onHand ?? 0;
    const reserved = inventory?.reserved ?? 0;
    // On-hand may never fall below what open orders already hold, or available
    // (on_hand - reserved) would go negative and the storefront would sell air.
    if (onHand < reserved) {
      throw new BadRequestException(
        `Stock cannot go below the ${reserved} unit(s) reserved by open orders`,
      );
    }

    const delta = onHand - current;
    if (delta === 0) {
      return { onHand: current, reserved, available: current - reserved };
    }
    return this.adjust(skuId, delta, reason ?? 'Stock set from product form', operatorId);
  }

  async defaultWarehouse() {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    if (!warehouse) {
      throw new BadRequestException('No active warehouse configured (run prisma db seed)');
    }

    return warehouse;
  }
}
