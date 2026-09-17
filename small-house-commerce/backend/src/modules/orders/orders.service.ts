import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type OrderStatus } from '../../generated/prisma/client.js';
import { normalizePhilippinePhone } from '../../common/phone.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { CheckoutInput, OrderQuery } from './dto/order.dto.js';

const ORDER_DETAIL_INCLUDE = {
  customer: true,
  items: true,
  shippingAddress: true,
  attribution: true,
  payments: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  reservations: true,
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * COD checkout (API_SPEC §18, decided rules):
   * - re-validate every SKU (exists, active, priced) and stock availability;
   *   any shortfall rejects the WHOLE order (no partial checkout)
   * - match/create the customer by normalized phone
   * - create the order with snapshots (DB-003), then reserve stock (§30)
   */
  async checkout(input: CheckoutInput) {
    const normalizedPhone = this.normalizePhone(input.customer.phone);

    // Resolve customer by canonical phone (§9: phone is the identity key).
    const customer = await this.prisma.customer.upsert({
      where: { normalizedPhone },
      update: { name: input.customer.name },
      create: { name: input.customer.name, normalizedPhone },
    });

    // Validate SKUs and gather the current catalog state for snapshots.
    const lines: {
      skuId: string;
      quantity: number;
      skuCode: string;
      productName: string;
      productId: string;
      variantId: string;
      variantName: string;
      unitPrice: Prisma.Decimal;
      unitCost: Prisma.Decimal | null;
    }[] = [];

    for (const item of input.items) {
      const sku = await this.prisma.sku.findUnique({
        where: { id: item.skuId },
        include: { variant: { include: { product: true } } },
      });

      if (!sku || sku.status !== 'ACTIVE' || sku.variant.product.status !== 'ACTIVE') {
        throw new BadRequestException(`SKU ${item.skuId} is not available for purchase`);
      }
      if (sku.price === null) {
        throw new BadRequestException(`SKU ${sku.skuCode} is not priced`);
      }

      lines.push({
        skuId: sku.id,
        quantity: item.quantity,
        skuCode: sku.skuCode,
        productName: sku.variant.product.name,
        productId: sku.variant.productId,
        variantId: sku.variant.id,
        variantName: sku.variant.name,
        unitPrice: sku.price,
        unitCost: sku.landedCost,
      });
    }

    // Stock validation: any shortfall rejects the whole order.
    const skuIds = [...new Set(lines.map((line) => line.skuId))];
    const availableBySku = await this.inventory.availableBySku(skuIds);

    for (const line of lines) {
      const available = availableBySku.get(line.skuId) ?? 0;
      if (available < line.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${line.skuCode}: available ${available}, requested ${line.quantity}`,
        );
      }
    }

    // Totals at the actual selling price: order lines already snapshot
    // unitPrice/lineTotal at the selling price, so subtotal = sum of lines.
    // compareAtPrice is a merchandising strikethrough, not an order discount —
    // subtracting it again undercharged every marked-down SKU; discountTotal is
    // reserved for order-level promotions (coupons), which don't exist yet.
    // Shipping is 0 until the shipping-rate-rules module lands.
    let subtotal = 0;
    for (const line of lines) {
      subtotal += Number(line.unitPrice) * line.quantity;
    }
    const discount = 0;
    const shippingTotal = 0;
    const grandTotal = subtotal - discount + shippingTotal;

    const orderNumber = await this.nextOrderNumber();
    const warehouse = await this.inventory.defaultWarehouse();

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId: customer.id,
          subtotal: new Prisma.Decimal(subtotal),
          discountTotal: new Prisma.Decimal(discount),
          shippingTotal: new Prisma.Decimal(shippingTotal),
          grandTotal: new Prisma.Decimal(grandTotal),
          preferredDeliveryDate: input.preferredDeliveryDate
            ? new Date(`${input.preferredDeliveryDate}T00:00:00+08:00`)
            : null,
          items: {
            create: lines.map((line) => ({
              skuId: line.skuId,
              productId: line.productId,
              variantId: line.variantId,
              productNameSnapshot: line.productName,
              skuCodeSnapshot: line.skuCode,
              variantSnapshot: line.variantName,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              unitDiscount: new Prisma.Decimal(0),
              unitCostSnapshot: line.unitCost,
              lineTotal: new Prisma.Decimal(Number(line.unitPrice) * line.quantity),
            })),
          },
          shippingAddress: {
            create: {
              fullName: input.customer.name,
              phone: input.customer.phone,
              province: input.customer.province,
              city: input.customer.city,
              barangay: input.customer.barangay ?? null,
              postalCode: input.customer.postalCode ?? null,
              streetAddress: input.customer.streetAddress,
              landmark: input.customer.landmark ?? null,
            },
          },
          attribution: {
            create: {
              sourceType: input.attribution.sourceType,
              aidSnapshot: input.attribution.aid ?? null,
              optimizerId: input.attribution.optimizerId ?? null,
              facebookPostId: input.attribution.facebookPostId ?? null,
              campaignId: input.attribution.campaignId ?? null,
              adsetId: input.attribution.adsetId ?? null,
              adId: input.attribution.adId ?? null,
              landingPageId: input.attribution.landingPageId ?? null,
              utmSource: input.attribution.utmSource ?? null,
              utmMedium: input.attribution.utmMedium ?? null,
              utmCampaign: input.attribution.utmCampaign ?? null,
            },
          },
          payments: {
            create: {
              method: 'COD',
              status: 'COD_PENDING',
              amount: new Prisma.Decimal(grandTotal),
            },
          },
        },
      });

      // Reserve stock per line (§30); any failure rolls back the order.
      for (const line of lines) {
        await this.inventory.reserveWithin(tx, line.skuId, warehouse.id, line.quantity, created.id);
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: created.id,
          statusDomain: 'ORDER_STATUS',
          newStatus: 'NEW',
          source: 'SYSTEM',
        },
      });

      return created;
    });

    // Risk rules (AGAIN/RPT/RECHECK) land in Phase 2; V1 always proceeds.
    return {
      orderNumber,
      orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED',
      riskType: null,
      requiresReview: false,
    };
  }

  /** §22.1 confirm: only while still unconfirmed and not cancelled. */
  async confirm(orderId: string, operatorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.orderStatus === 'CANCELLED' || order.orderStatus === 'DENIED') {
      throw new BadRequestException('Cancelled or denied orders cannot be confirmed');
    }
    if (order.confirmationStatus === 'CONFIRMED') {
      throw new ConflictException('Order is already confirmed');
    }
    if (order.orderStatus === 'SHIPPING' || order.orderStatus === 'SIGNED') {
      throw new BadRequestException('Shipped orders cannot be confirmed');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          orderStatus: 'CONFIRMED',
          confirmationStatus: 'CONFIRMED',
          confirmedBy: operatorId,
          confirmedAt: new Date(),
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          statusDomain: 'ORDER_STATUS',
          oldStatus: order.orderStatus,
          newStatus: 'CONFIRMED',
          source: 'ADMIN',
          operatorId,
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          statusDomain: 'CONFIRMATION_STATUS',
          oldStatus: order.confirmationStatus,
          newStatus: 'CONFIRMED',
          source: 'ADMIN',
          operatorId,
        },
      });
      return updated;
    });
  }

  /** §22.2 cancel: allowed until shipping; releases reservations (§31). */
  async cancel(orderId: string, operatorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const terminal = new Set<OrderStatus>(['CANCELLED', 'DENIED', 'SIGNED', 'AFTER_SALES']);
    if (terminal.has(order.orderStatus)) {
      throw new BadRequestException(`Order cannot be cancelled from status ${order.orderStatus}`);
    }
    if (order.orderStatus === 'SHIPPING') {
      throw new BadRequestException('Shipped orders cannot be cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { orderStatus: 'CANCELLED' },
      });
      await this.inventory.releaseForOrder(tx, orderId);
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          statusDomain: 'ORDER_STATUS',
          oldStatus: order.orderStatus,
          newStatus: 'CANCELLED',
          source: 'ADMIN',
          operatorId,
        },
      });
      return updated;
    });
  }

  async list(query: OrderQuery) {
    const where: Prisma.OrderWhereInput = {};

    if (query.status) where.orderStatus = query.status;
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { normalizedPhone: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        gte: query.dateFrom ? new Date(`${query.dateFrom}T00:00:00Z`) : undefined,
        lte: query.dateTo ? new Date(`${query.dateTo}T23:59:59Z`) : undefined,
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          customer: true,
          items: { select: { id: true, skuCodeSnapshot: true, productNameSnapshot: true, quantity: true, lineTotal: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  /**
   * Guest order lookup (spec §3.1): exact order-number + phone match.
   * Every failure (missing order, unparseable phone, non-matching phone)
   * resolves to the SAME 404 so the response cannot reveal order existence.
   */
  async lookup(orderNumber: string, phone: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: ORDER_DETAIL_INCLUDE,
    });

    const notFound = () =>
      new NotFoundException(
        'Order not found. Check your order number and mobile number.',
      );

    if (!order) {
      throw notFound();
    }

    // The shared util returns null for unparseable input (and may throw in
    // other call styles); either outcome is a non-match here, never a 400.
    let queryPhone: string | null = null;
    try {
      queryPhone = normalizePhilippinePhone(phone);
    } catch {
      queryPhone = null;
    }

    let snapshotPhone: string | null = null;
    const storedSnapshotPhone = order.shippingAddress?.phone;
    if (storedSnapshotPhone) {
      try {
        snapshotPhone = normalizePhilippinePhone(storedSnapshotPhone);
      } catch {
        snapshotPhone = null;
      }
    }

    const customerPhone = order.customer?.normalizedPhone ?? null;
    if (
      !queryPhone ||
      (queryPhone !== customerPhone && queryPhone !== snapshotPhone)
    ) {
      throw notFound();
    }

    return order;
  }

  private normalizePhone(phone: string): string {
    const normalized = normalizePhilippinePhone(phone);
    if (!normalized) {
      throw new BadRequestException(`Invalid Philippine phone number: "${phone}"`);
    }
    return normalized;
  }

  private async nextOrderNumber(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('order_number_seq') AS nextval
    `;
    return `PH${rows[0].nextval}`;
  }
}
