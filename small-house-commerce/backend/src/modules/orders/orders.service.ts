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
import { CustomerRiskService, type CustomerClassification } from './customer-risk.service.js';
import type { CheckoutInput, EditOrderInput, MergeOrdersInput, OrderQuery } from './dto/order.dto.js';

const ORDER_DETAIL_INCLUDE = {
  customer: {
    include: {
      notes: { orderBy: { createdAt: 'desc' as const } },
      riskLogs: { orderBy: { createdAt: 'desc' as const } },
    },
  },
  items: true,
  shippingAddress: true,
  attribution: true,
  payments: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  reservations: true,
  notes: { orderBy: { createdAt: 'desc' as const } },
  riskFlags: { orderBy: { createdAt: 'desc' as const } },
  mergeRecordsPrimary: { include: { mergedOrder: { select: { id: true, orderNumber: true } } } },
  mergeRecordsMerged: { include: { primaryOrder: { select: { id: true, orderNumber: true } } } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly customerRisk: CustomerRiskService,
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

    // Customer classification snapshot (CUSTOMER_RISK_SPEC §7): computed for
    // the new order from prior history; stored on the order, never recomputed.
    const classification = await this.customerRisk.classifyForNewOrder(normalizedPhone);

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId: customer.id,
          customerClassification: classification.classification,
          subtotal: new Prisma.Decimal(subtotal),
          discountTotal: new Prisma.Decimal(discount),
          shippingTotal: new Prisma.Decimal(shippingTotal),
          grandTotal: new Prisma.Decimal(grandTotal),
          preferredDeliveryDate: input.preferredDeliveryDate
            ? new Date(`${input.preferredDeliveryDate}T00:00:00Z`)
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

    // Risk records (§10): the classification decision is logged. RPT/RECHECK
    // flip the confirmation status so the admin workbench review queue sees
    // them (CUSTOMER_RISK_SPEC §17 manual confirmation).
    await this.customerRisk.logRisk({
      customerId: customer.id,
      orderId: order.id,
      riskType: classification.classification,
      previousOrderId: classification.previousOrderId,
      reason: classification.reason,
    });
    if (classification.classification === 'RPT' || classification.classification === 'RECHECK') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { confirmationStatus: 'NEEDS_REVIEW' },
      });
    }

    // Duplicate detection (§14): mark, never delete.
    await this.customerRisk.markDuplicates(normalizedPhone);

    const requiresReview = classification.classification === 'RPT' || classification.classification === 'RECHECK';
    return {
      orderNumber,
      orderStatus: 'NEW',
      confirmationStatus: requiresReview ? 'NEEDS_REVIEW' : 'UNCONFIRMED',
      riskType: requiresReview ? classification.classification : null,
      requiresReview,
    };
  }

  /** §22.1 confirm: only while still unconfirmed and not cancelled. */
  async confirm(
    orderId: string,
    operatorId: string,
    decision?: { decision: 'CONFIRM' | 'CANCEL' | 'REQUEST_INFO'; note?: string },
  ) {
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

    // CUSTOMER_RISK_SPEC §17 gate: RPT/RECHECK orders need a manual customer
    // service review decision before confirmation (Phase 2 landing).
    const classification = (order.customerClassification ?? 'NEW') as CustomerClassification;
    const needsReview = classification === 'RPT' || classification === 'RECHECK';
    if (needsReview && !decision) {
      throw new BadRequestException(
        `Order ${order.orderNumber} is classified ${classification}; a customer-service decision is required before confirmation`,
      );
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
      if (needsReview && decision) {
        // §10 risk log + §13 customer note for the review decision.
        await tx.customerRiskLog.create({
          data: {
            customerId: order.customerId,
            orderId,
            riskType: classification,
            reason: `Review decision: ${decision.decision}${decision.note ? ` — ${decision.note}` : ''}`,
            operatorId,
          },
        });
        await tx.customerNote.create({
          data: {
            customerId: order.customerId,
            orderId,
            operatorId,
            note: `Review decision: ${decision.decision}${decision.note ? ` — ${decision.note}` : ''}`,
          },
        });
      }
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

  // --- Order workbench operations (2026-09-18 spec) ------------------------

  /** Users eligible as customer-service assignees (all ACTIVE admins). */
  async assignees() {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return users;
  }

  /** Assign / reassign the customer-service owner of an order. */
  async assign(orderId: string, assignedToId: string, operatorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          assignedToId,
          assignedBy: operatorId,
          assignedAt: new Date(),
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          statusDomain: 'ASSIGNMENT',
          oldStatus: order.assignedToId ?? null,
          newStatus: assignedToId,
          source: 'ADMIN',
          operatorId,
          comment: 'Customer-service reassignment',
        },
      });
      return updated;
    });
  }

  /** Status transition with the §6.2 legality table. */
  async updateStatus(orderId: string, status: OrderStatus, comment: string | undefined, operatorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const legal: Record<string, OrderStatus[]> = {
      NEW: ['PENDING', 'QUESTION', 'CONFIRMED', 'CANCELLED', 'DENIED'],
      PENDING: ['QUESTION', 'CONFIRMED', 'CANCELLED', 'DENIED', 'ABNORMAL'],
      QUESTION: ['PENDING', 'CONFIRMED', 'CANCELLED', 'DENIED'],
      CONFIRMED: ['SHIPPING', 'CANCELLED', 'DENIED', 'AFTER_SALES'],
      ABNORMAL: ['PENDING', 'QUESTION', 'CONFIRMED', 'CANCELLED', 'DENIED', 'AFTER_SALES'],
      SHIPPING: ['SIGNED', 'CANCELLED', 'AFTER_SALES'],
      SIGNED: ['AFTER_SALES'],
      CANCELLED: [],
      DENIED: [],
      AFTER_SALES: [],
    };
    const targets = legal[order.orderStatus];
    if (!targets?.includes(status)) {
      throw new BadRequestException(
        `Invalid status transition ${order.orderStatus} -> ${status}`,
      );
    }

    // Status changes that release or re-check inventory.
    const releasesStock = status === 'CANCELLED' || status === 'DENIED';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { orderStatus: status },
      });
      if (releasesStock && order.orderStatus !== status) {
        await this.inventory.releaseForOrder(tx, orderId);
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          statusDomain: 'ORDER_STATUS',
          oldStatus: order.orderStatus,
          newStatus: status,
          source: 'ADMIN',
          operatorId,
          comment: comment ?? null,
        },
      });
      return updated;
    });
  }

  /**
   * Edit shipping address snapshot / order items. Item edits adjust inventory
   * reservations per-line (§30–§32) and recompute totals server-side.
   */
  async edit(orderId: string, input: EditOrderInput, operatorId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, shippingAddress: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const terminal = new Set(['CANCELLED', 'DENIED', 'SIGNED', 'AFTER_SALES']);
    if (terminal.has(order.orderStatus)) {
      throw new BadRequestException(`Order ${order.orderStatus} cannot be edited`);
    }

    const warehouse = await this.inventory.defaultWarehouse();

    return this.prisma.$transaction(async (tx) => {
      // --- Shipping address snapshot ---
      if (input.shippingAddress) {
        const a = input.shippingAddress;
        if (order.shippingAddress) {
          await tx.orderShippingAddress.update({
            where: { orderId },
            data: {
              fullName: a.fullName,
              phone: a.phone,
              province: a.province,
              city: a.city,
              barangay: a.barangay ?? null,
              postalCode: a.postalCode ?? null,
              streetAddress: a.streetAddress,
              landmark: a.landmark ?? null,
            },
          });
        } else {
          await tx.orderShippingAddress.create({
            data: {
              orderId,
              fullName: a.fullName,
              phone: a.phone,
              province: a.province,
              city: a.city,
              barangay: a.barangay ?? null,
              postalCode: a.postalCode ?? null,
              streetAddress: a.streetAddress,
              landmark: a.landmark ?? null,
            },
          });
        }
      }

      // --- Items: diff against current lines, adjust reservations ---
      if (input.items) {
        const current = new Map(order.items.map((i) => [i.skuId, i]));
        const next = new Map(input.items.map((i) => [i.skuId, i.quantity]));
        const skuIds = [...new Set([...current.keys(), ...next.keys()])];
        const skus = await tx.sku.findMany({
          where: { id: { in: skuIds } },
          include: { variant: { include: { product: true } } },
        });
        const skuById = new Map(skus.map((s) => [s.id, s]));

        // Removed lines: delete + release reservation.
        for (const [skuId, item] of current) {
          if (next.has(skuId)) continue;
          await tx.orderItem.delete({ where: { id: item.id } });
          await this.inventory.releaseForOrder(tx, orderId);
        }
        // Quantity changes: diff reservation.
        for (const [skuId, qty] of next) {
          const existing = current.get(skuId);
          if (!existing) {
            // New line: validate and reserve.
            const sku = skuById.get(skuId);
            if (!sku || sku.status !== 'ACTIVE' || sku.variant.product.status !== 'ACTIVE') {
              throw new BadRequestException(`SKU ${skuId} is not available`);
            }
            if (sku.price === null) {
              throw new BadRequestException(`SKU ${sku.skuCode} is not priced`);
            }
            await tx.orderItem.create({
              data: {
                orderId,
                skuId,
                productId: sku.variant.productId,
                variantId: sku.variant.id,
                productNameSnapshot: sku.variant.product.name,
                skuCodeSnapshot: sku.skuCode,
                variantSnapshot: sku.variant.name,
                quantity: qty,
                unitPrice: sku.price,
                unitDiscount: new Prisma.Decimal(0),
                unitCostSnapshot: sku.landedCost,
                lineTotal: new Prisma.Decimal(Number(sku.price) * qty),
              },
            });
            await this.inventory.reserveWithin(tx, skuId, warehouse.id, qty, orderId);
            continue;
          }
          if (existing.quantity === qty) continue;
          await tx.orderItem.update({
            where: { id: existing.id },
            data: {
              quantity: qty,
              lineTotal: new Prisma.Decimal(Number(existing.unitPrice) * qty),
            },
          });
          const delta = qty - existing.quantity;
          if (delta > 0) {
            await this.inventory.reserveWithin(tx, skuId, warehouse.id, delta, orderId);
          } else {
            // Release the surplus back; releaseForOrder releases everything,
            // so manually re-reserve what should stay.
            await this.inventory.releaseForOrder(tx, orderId);
            await this.inventory.reserveWithin(tx, skuId, warehouse.id, qty, orderId);
          }
        }

        // Recompute totals from the resulting lines.
        const items = await tx.orderItem.findMany({ where: { orderId } });
        let subtotal = 0;
        for (const item of items) {
          subtotal += Number(item.unitPrice) * item.quantity;
        }
        const grandTotal = subtotal - Number(order.discountTotal) + Number(order.shippingTotal);
        await tx.order.update({
          where: { id: orderId },
          data: {
            subtotal: new Prisma.Decimal(subtotal),
            grandTotal: new Prisma.Decimal(grandTotal),
          },
        });
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          statusDomain: 'EDIT',
          oldStatus: null,
          newStatus: 'EDITED',
          source: 'ADMIN',
          operatorId,
          comment: input.note ?? 'Order edited',
        },
      });
      return this.get(orderId);
    });
  }

  /** Append an internal order note (§46). */
  async addNote(orderId: string, content: string, noteType: string, operatorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) throw new NotFoundException('Order not found');
    return this.prisma.orderNote.create({
      data: { orderId, userId: operatorId, noteType, content },
    });
  }

  /** Append a customer communication record (§13). */
  async addCustomerNote(customerId: string, note: string, orderId: string | null, operatorId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customerNote.create({
      data: { customerId, orderId, operatorId, note },
    });
  }

  /** Manually add a risk flag (§47); downgrades resolve existing flags. */
  async addRiskFlag(orderId: string, flagType: string, reason: string | undefined, operatorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.orderRiskFlag.create({
        data: { orderId, flagType, reason: reason ?? null, createdBy: operatorId },
      });
      await tx.customerRiskLog.create({
        data: {
          customerId: order.customerId,
          orderId,
          riskType: (order.customerClassification ?? 'NEW') as CustomerClassification,
          reason: `Flag ${flagType} added${reason ? ` — ${reason}` : ''}`,
          operatorId,
        },
      });
      return flag;
    });
  }

  /** Resolve a risk flag (requires admin approval per §8 — caller checks role). */
  async resolveRiskFlag(flagId: string, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.orderRiskFlag.update({
        where: { id: flagId },
        data: { resolved: true, resolvedAt: new Date() },
      });
      await tx.customerRiskLog.create({
        data: {
          customerId: (await tx.order.findUnique({ where: { id: flag.orderId }, select: { customerId: true } }))?.customerId ?? '',
          orderId: flag.orderId,
          riskType: 'NEW',
          reason: `Flag ${flag.flagType} resolved`,
          operatorId,
        },
      });
      return flag;
    });
  }

  /**
   * Order merge (DATABASE §48 + CUSTOMER_RISK_SPEC §15): only NEW/PENDING/
   * CONFIRMED orders, same customer+phone+address, keep the oldest order.
   */
  async merge(input: MergeOrdersInput, operatorId: string) {
    const [primary, merged] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id: input.primaryOrderId },
        include: { shippingAddress: true, items: true },
      }),
      this.prisma.order.findUnique({
        where: { id: input.mergedOrderId },
        include: { shippingAddress: true, items: true },
      }),
    ]);
    if (!primary || !merged) throw new NotFoundException('Order not found');
    if (primary.id === merged.id) throw new BadRequestException('Cannot merge an order with itself');

    const mergeable = new Set(['NEW', 'PENDING', 'CONFIRMED']);
    if (!mergeable.has(primary.orderStatus) || !mergeable.has(merged.orderStatus)) {
      throw new BadRequestException('Only NEW/PENDING/CONFIRMED orders can be merged');
    }
    if (primary.customerId !== merged.customerId) {
      throw new BadRequestException('Orders must belong to the same customer');
    }
    const samePhone = primary.shippingAddress?.phone === merged.shippingAddress?.phone;
    const sameAddress =
      primary.shippingAddress?.streetAddress === merged.shippingAddress?.streetAddress &&
      primary.shippingAddress?.province === merged.shippingAddress?.province &&
      primary.shippingAddress?.city === merged.shippingAddress?.city;
    if (!samePhone || !sameAddress) {
      throw new BadRequestException('Orders must share the same phone and delivery address');
    }

    // Keep the oldest as primary.
    const [kept, dropped] =
      primary.createdAt <= merged.createdAt
        ? [primary, merged]
        : [merged, primary];

    return this.prisma.$transaction(async (tx) => {
      // Move merged items into the kept order.
      for (const item of dropped.items) {
        const existing = kept.items.find(
          (k) => k.skuId === item.skuId && k.unitPrice.equals(item.unitPrice),
        );
        if (existing) {
          await tx.orderItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + item.quantity, lineTotal: existing.lineTotal.add(item.lineTotal) },
          });
        } else {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { orderId: kept.id },
          });
        }
      }

      // Recompute kept totals.
      const keptItems = await tx.orderItem.findMany({ where: { orderId: kept.id } });
      let subtotal = 0;
      for (const item of keptItems) subtotal += Number(item.unitPrice) * item.quantity;
      await tx.order.update({
        where: { id: kept.id },
        data: {
          subtotal: new Prisma.Decimal(subtotal),
          grandTotal: new Prisma.Decimal(subtotal - Number(kept.discountTotal) + Number(kept.shippingTotal)),
        },
      });

      // Cancel the dropped order: release its reservation, mark CANCELLED.
      await this.inventory.releaseForOrder(tx, dropped.id);
      await tx.order.update({
        where: { id: dropped.id },
        data: { orderStatus: 'CANCELLED' },
      });

      // Audit both sides (§48: merged history is never deleted).
      await tx.orderMergeRecord.create({
        data: {
          primaryOrderId: kept.id,
          mergedOrderId: dropped.id,
          operatorId,
          reason: input.reason ?? null,
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: kept.id,
          statusDomain: 'MERGE',
          oldStatus: null,
          newStatus: 'MERGED',
          source: 'ADMIN',
          operatorId,
          comment: `Merged order ${dropped.orderNumber}${input.reason ? ` — ${input.reason}` : ''}`,
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: dropped.id,
          statusDomain: 'ORDER_STATUS',
          oldStatus: dropped.orderStatus,
          newStatus: 'CANCELLED',
          source: 'ADMIN',
          operatorId,
          comment: `Merged into ${kept.orderNumber}${input.reason ? ` — ${input.reason}` : ''}`,
        },
      });

      return this.get(kept.id);
    });
  }

  async list(query: OrderQuery) {
    const where: Prisma.OrderWhereInput = {};

    if (query.status) where.orderStatus = query.status;
    if (query.classification) where.customerClassification = query.classification;
    if (query.assignedTo) where.assignedToId = query.assignedTo;
    if (query.risk) {
      where.riskFlags = { some: { flagType: query.risk, resolved: false } };
    }
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
          riskFlags: { where: { resolved: false } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    // Attach assigned-to operator names (users table).
    const assignedIds = [...new Set(items.map((o) => o.assignedToId).filter((id): id is string => Boolean(id)))];
    const operators = assignedIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: assignedIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(operators.map((u) => [u.id, u.name]));
    const enriched = items.map((o) => ({
      ...o,
      assignedTo: o.assignedToId ? { id: o.assignedToId, name: nameById.get(o.assignedToId) ?? null } : null,
    }));

    return { items: enriched, total, page: query.page, pageSize: query.pageSize };
  }

  async get(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Resolve operator display names for history/notes/risk-logs.
    const operatorIds = new Set<string>();
    for (const h of order.statusHistory) if (h.operatorId) operatorIds.add(h.operatorId);
    for (const n of order.notes) if (n.userId) operatorIds.add(n.userId);
    for (const r of order.customer.riskLogs) if (r.operatorId) operatorIds.add(r.operatorId);
    for (const n of order.customer.notes) if (n.operatorId) operatorIds.add(n.operatorId);
    if (order.assignedToId) operatorIds.add(order.assignedToId);
    if (order.assignedBy) operatorIds.add(order.assignedBy);

    const operators = operatorIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...operatorIds] } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(operators.map((u) => [u.id, u.name]));

    const assignee = order.assignedToId
      ? { id: order.assignedToId, name: nameById.get(order.assignedToId) ?? null }
      : null;
    const assigner = order.assignedBy
      ? { id: order.assignedBy, name: nameById.get(order.assignedBy) ?? null }
      : null;

    return {
      ...order,
      assignedTo: assignee,
      assignedBy: assigner,
      statusHistory: order.statusHistory.map((h) => ({
        ...h,
        operatorName: h.operatorId ? (nameById.get(h.operatorId) ?? null) : null,
      })),
      notes: order.notes.map((n) => ({ ...n, operatorName: n.userId ? (nameById.get(n.userId) ?? null) : null })),
      customer: {
        ...order.customer,
        notes: order.customer.notes.map((n) => ({
          ...n,
          operatorName: n.operatorId ? (nameById.get(n.operatorId) ?? null) : null,
        })),
        riskLogs: order.customer.riskLogs.map((r) => ({
          ...r,
          operatorName: r.operatorId ? (nameById.get(r.operatorId) ?? null) : null,
        })),
      },
    };
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
