// Customer risk classification + duplicate detection.
//
// Sources:
//   docs/CUSTOMER_RISK_SPEC.md §7 (risk evaluation algorithm),
//     §10 (customer_risk_logs), §14 (duplicate detection),
//     §17 (confirmation strategy)
//   docs/DATABASE.md §14 (order_customer_classification NEW/AGAIN/RPT/RECHECK),
//     §47 (order_risk_flags, never auto-delete orders)
//
// Classification is a snapshot computed when a new order enters the system
// (§14 "calculated when the new order enters the system and stored as a
// snapshot"). Duplicate detection marks POSSIBLE_DUPLICATE flags without
// deleting anything (§47).

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export const CUSTOMER_CLASSIFICATIONS = ['NEW', 'AGAIN', 'RPT', 'RECHECK'] as const;
export type CustomerClassification = (typeof CUSTOMER_CLASSIFICATIONS)[number];

export const RISK_FLAG_TYPES = ['POSSIBLE_DUPLICATE', 'CUSTOMER_RECHECK', 'CUSTOMER_BLOCKED'] as const;
export type RiskFlagType = (typeof RISK_FLAG_TYPES)[number];

/** Same-product duplicate window (CUSTOMER_RISK_SPEC §14: within 24 hours). */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CustomerRiskService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * CUSTOMER_RISK_SPEC §7 Step 3: derive the classification for a new order.
   * Priority RECHECK > RPT > AGAIN > NEW (DATABASE §17).
   *
   * History lookup by normalizedPhone (the identity key, §9); V1 has no
   * pre-order leads layer, so only orders are considered.
   */
  async classifyForNewOrder(
    normalizedPhone: string,
    previousOrderIds: string[] = [],
  ): Promise<{ classification: CustomerClassification; reason: string; previousOrderId: string | null }> {
    // Load history through the customer row (same canonical phone).
    const customer = await this.prisma.customer.findUnique({
      where: { normalizedPhone },
      include: {
        orders: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, orderStatus: true },
        },
      },
    });

    const history = customer?.orders ?? [];
    if (history.length === 0) {
      return { classification: 'NEW', reason: 'No prior orders', previousOrderId: null };
    }

    const prior = history.filter((o) => !previousOrderIds.includes(o.id));
    const last = prior.length > 0 ? prior[prior.length - 1] : null;

    const deniedCount = prior.filter((o) => o.orderStatus === 'DENIED').length;
    const failedDelivery = prior.some((o) => o.orderStatus === 'DENIED'); // failed-delivery history maps to DENIED in V1
    const activePending = prior.some((o) =>
      ['PENDING', 'SHIPPING', 'CONFIRMED'].includes(o.orderStatus),
    );
    const signedCount = prior.filter((o) => o.orderStatus === 'SIGNED').length;

    if (deniedCount > 0 || failedDelivery) {
      return {
        classification: 'RECHECK',
        reason: `Previous denied/failed-delivery history (${deniedCount})`,
        previousOrderId: last?.id ?? null,
      };
    }
    if (activePending) {
      return {
        classification: 'RPT',
        reason: 'Active previous order exists',
        previousOrderId: last?.id ?? null,
      };
    }
    if (signedCount > 0) {
      return {
        classification: 'AGAIN',
        reason: `Previous signed order (${signedCount})`,
        previousOrderId: last?.id ?? null,
      };
    }
    return { classification: 'NEW', reason: 'No risk factors', previousOrderId: last?.id ?? null };
  }

  /**
   * CUSTOMER_RISK_SPEC §14 duplicate detection: same phone + similar product
   * (same productId or SKU) + within 24h → POSSIBLE_DUPLICATE flag on each
   * involved order. Never deletes (§47). Idempotent: re-running refreshes
   * flags instead of duplicating rows.
   */
  async markDuplicates(normalizedPhone: string, opts: { tx?: Prisma.TransactionClient } = {}): Promise<void> {
    const db = opts.tx ?? this.prisma;
    const customer = await db.customer.findUnique({
      where: { normalizedPhone },
      include: {
        orders: {
          orderBy: { createdAt: 'asc' },
          include: { items: { select: { productId: true, skuId: true } } },
        },
      },
    });
    if (!customer || customer.orders.length < 2) return;

    for (const order of customer.orders) {
      const dup = customer.orders.some((other) => {
        if (other.id === order.id) return false;
        // Orders are duplicates only when the two orders are close to each
        // other (spec: multiple orders within 24 hours), not relative to now.
        const gap = Math.abs(other.createdAt.getTime() - order.createdAt.getTime());
        if (gap > DUPLICATE_WINDOW_MS) return false;
        const sameProduct = order.items.some((a) =>
          other.items.some((b) => a.productId && a.productId === b.productId),
        );
        const sameSku = order.items.some((a) => other.items.some((b) => a.skuId === b.skuId));
        return sameProduct || sameSku;
      });

      if (!dup) continue;
      const existing = await db.orderRiskFlag.findFirst({
        where: { orderId: order.id, flagType: 'POSSIBLE_DUPLICATE', resolved: false },
      });
      if (existing) continue;
      await db.orderRiskFlag.create({
        data: {
          orderId: order.id,
          flagType: 'POSSIBLE_DUPLICATE',
          reason: `Duplicate of another order for phone ${normalizedPhone} within 24h`,
          createdBy: null,
        },
      });
    }
  }

  /** CUSTOMER_RISK_SPEC §10: every risk decision is recorded. */
  async logRisk(
    input: {
      customerId: string;
      orderId?: string | null;
      riskType: CustomerClassification;
      previousOrderId?: string | null;
      reason?: string | null;
      operatorId?: string | null;
    },
    opts: { tx?: Prisma.TransactionClient } = {},
  ): Promise<void> {
    const db = opts.tx ?? this.prisma;
    await db.customerRiskLog.create({
      data: {
        customerId: input.customerId,
        orderId: input.orderId ?? null,
        riskType: input.riskType,
        previousOrderId: input.previousOrderId ?? null,
        reason: input.reason ?? null,
        operatorId: input.operatorId ?? null,
      },
    });
  }
}
