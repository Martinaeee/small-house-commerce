import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type OrderStatus } from '../../generated/prisma/client.js';
import { normalizePhilippinePhone } from '../../common/phone.util.js';
import { manilaDayEndExclusive, manilaDayStart } from '../../common/manila-day.js';
import {
  CACHE_TAGS,
  revalidateCache,
} from '../../common/revalidation.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  aggregateRequirements,
  cartRequirements,
  computeBundleAvailability,
  requirementsFromBundleSnapshot,
  validateBundleDefinition,
  type BundleRequirement,
} from '../inventory/bundle-inventory.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { MarketingTouchService } from '../marketing/marketing-touch.service.js';
import { MetaCapiService } from '../meta-capi/meta-capi.service.js';
import type { CheckoutRequestMeta } from '../meta-capi/request-meta.js';
import { BackInStockService } from '../newsletter/back-in-stock.service.js';
import { PromotionService } from '../newsletter/promotion.service.js';
import { computeDiscount } from '../newsletter/promotion-pricing.js';
import { CustomerRiskService, type CustomerClassification } from './customer-risk.service.js';
import {
  buildBundleSnapshot,
  buildOrderItemSnapshot,
  readBundleSnapshot,
  sameBundleSnapshot,
  type OrderBundleSnapshotV1,
  type OrderItemSnapshotWrite,
} from './order-item-snapshot.js';
import type { CheckoutInput, EditOrderInput, MergeOrdersInput, OrderQuery, ShipOrderInput } from './dto/order.dto.js';
import { idempotencyFingerprint } from './order-idempotency.js';
import {
  orderStatusAfterSign,
  quantityByLine,
  type ShipmentSnapshot,
} from './return-outcome.js';

/**
 * The verification progress of one order, as the workbench table shows it
 * under the status: how many questions are done and how many are still open.
 */
export interface VerificationSummary {
  assigned: boolean;
  done: number;
  total: number;
  pending: number;
  problem: number;
  priority: string | null;
  nextFollowUpAt: Date | null;
  assigneeId: string | null;
}

function verificationSummary(
  assignments:
    | {
        id: string;
        assigneeId: string | null;
        priority: string;
        nextFollowUpAt: Date | null;
        items: { required: boolean; status: string }[];
      }[]
    | undefined,
): VerificationSummary {
  const assignment = assignments?.[0] ?? null;
  const items = assignment?.items ?? [];
  return {
    assigned: Boolean(assignment),
    done: items.filter((i) => i.status === 'DONE' || i.status === 'SKIPPED').length,
    total: items.length,
    pending: items.filter((i) => i.status === 'PENDING').length,
    problem: items.filter((i) => i.status === 'PROBLEM').length,
    priority: assignment?.priority ?? null,
    nextFollowUpAt: assignment?.nextFollowUpAt ?? null,
    assigneeId: assignment?.assigneeId ?? null,
  };
}

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
  returnAcceptances: {
    include: { items: true },
    orderBy: { receivedAt: 'desc' as const },
  },
  mergeRecordsPrimary: { include: { mergedOrder: { select: { id: true, orderNumber: true } } } },
  mergeRecordsMerged: { include: { primaryOrder: { select: { id: true, orderNumber: true } } } },
  shipments: {
    include: {
      items: { include: { orderItem: true } },
      events: { orderBy: [{ eventTime: 'desc' as const }, { receivedAt: 'desc' as const }] },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  verificationAssignments: {
    where: { closedAt: null },
    select: {
      id: true,
      assigneeId: true,
      priority: true,
      nextFollowUpAt: true,
      items: {
        select: {
          id: true,
          itemKey: true,
          titleSnapshot: true,
          required: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

/**
 * What the guest order-tracking page is allowed to see. Deliberately NOT
 * ORDER_DETAIL_INCLUDE: that one carries staff notes, risk flags, optimizer
 * attribution, inventory reservations and the per-line cost snapshot — none
 * of which a shopper may read. The guest view is the order itself.
 */
const GUEST_ORDER_INCLUDE = {
  customer: {
    select: { id: true, name: true, normalizedPhone: true, email: true },
  },
  items: {
    select: {
      id: true,
      productId: true,
      variantId: true,
      skuId: true,
      productNameSnapshot: true,
      skuCodeSnapshot: true,
      variantSnapshot: true,
      optionSnapshot: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      createdAt: true,
      // The photo the shopper sees for this line. There is no image snapshot
      // on the order line, so this is the product's current media, matched to
      // the ordered option value first. The product is reached through the
      // SKU: an order line points at a SKU, not at the product.
      sku: {
        select: {
          product: {
            select: {
              slug: true,
              status: true,
              images: {
                where: { type: 'IMAGE' as const },
                orderBy: { sortOrder: 'asc' as const },
                select: {
                  url: true,
                  variantId: true,
                  optionValueId: true,
                  isScene: true,
                },
              },
            },
          },
        },
      },
    },
  },
  shippingAddress: true,
  statusHistory: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      statusDomain: true,
      oldStatus: true,
      newStatus: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderInclude;

/** A SKU loaded with the Bundle bindings needed to validate and freeze it. */
type SkuWithBundleComponents = {
  id: string;
  skuCode: string;
  isBundle: boolean;
  bundleComponents: readonly {
    componentSkuId: string;
    quantity: number;
    position: number;
    componentSku: {
      skuCode: string;
      status: string;
      isBundle: boolean;
      variant: { name: string; product: { name: string; status: string } };
    };
  }[];
};

/**
 * The photo for an ordered line: the image of the exact option value the
 * shopper chose, else the variant's, else the product's own. Scene photos
 * (the room-scene sets) are not product shots and never used here.
 */
function guestThumbnail(item: {
  optionSnapshot: unknown;
  variantId: string | null;
  sku: {
    product: {
      images: Array<{
        url: string;
        variantId: string | null;
        optionValueId: string | null;
        isScene: boolean;
      }>;
    } | null;
  } | null;
}): string | null {
  const images = (item.sku?.product?.images ?? []).filter(
    (image) => !image.isScene,
  );
  if (images.length === 0) return null;

  const snapshot = item.optionSnapshot as {
    options?: Array<{ optionValueId?: string | null }>;
  } | null;
  const valueIds = new Set(
    (snapshot?.options ?? [])
      .map((option) => option.optionValueId)
      .filter((id): id is string => Boolean(id)),
  );

  const byOption = images.find(
    (image) => image.optionValueId !== null && valueIds.has(image.optionValueId),
  );
  if (byOption) return byOption.url;

  const byVariant = images.find(
    (image) => image.variantId !== null && image.variantId === item.variantId,
  );
  if (byVariant) return byVariant.url;

  const shared = images.find(
    (image) => image.variantId === null && image.optionValueId === null,
  );
  return shared?.url ?? null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly customerRisk: CustomerRiskService,
    private readonly marketingTouch: MarketingTouchService,
    private readonly promotions: PromotionService,
    private readonly backInStock: BackInStockService,
    // Optional so direct unit constructions keep working; Nest injects it.
    @Optional() private readonly metaCapi?: MetaCapiService,
  ) {}

  /**
   * COD checkout (API_SPEC §18, decided rules):
   * - re-validate every SKU (exists, active, priced) and stock availability;
   *   any shortfall rejects the WHOLE order (no partial checkout)
   * - match/create the customer by normalized phone
   * - create the order with snapshots (DB-003), then reserve stock (§30)
   */
  async checkout(input: CheckoutInput, requestMeta?: CheckoutRequestMeta) {
    // A retry (timeout, lost response, double click) must return the order the
    // first attempt created instead of creating another one. The pre-check
    // also covers the common replay before touching the customer table.
    const idempotencyHash = input.idempotencyKey ? idempotencyFingerprint(input) : null;
    if (input.idempotencyKey && idempotencyHash) {
      const replay = await this.findIdempotentOrder(input.idempotencyKey, idempotencyHash);
      if (replay) return replay;
    }

    const normalizedPhone = this.normalizePhone(input.customer.phone);

    // Customer classification snapshot (CUSTOMER_RISK_SPEC §7): computed for
    // the new order from prior history; stored on the order, never recomputed.
    const classification = await this.customerRisk.classifyForNewOrder(normalizedPhone);

    const runCheckoutTransaction = () =>
      this.prisma.$transaction(async (tx) => {
    // Resolve customer by canonical phone (§9: phone is the identity key)
    // inside the order transaction, so a failed or conflicting attempt does
    // not leave a customer record behind.
    const customer = await tx.customer.upsert({
      where: { normalizedPhone },
      update: { name: input.customer.name },
      create: { name: input.customer.name, normalizedPhone },
    });
    for (const skuId of [...new Set(input.items.map(item => item.skuId))].sort()) {
      await tx.$queryRaw`SELECT id FROM skus WHERE id = ${skuId}::uuid AND is_bundle = TRUE FOR UPDATE`;
    }
    // Validate SKUs and gather the current catalog state for snapshots.
    const lines: {
      skuId: string;
      quantity: number;
      skuCode: string;
      productName: string;
      productId: string;
      variantId: string;
      snapshot: OrderItemSnapshotWrite;
      isBundle: boolean;
      bundleSnapshot: OrderBundleSnapshotV1 | null;
      components: {
        componentSkuId: string;
        quantity: number;
        skuCode: string;
        status: string;
        productStatus: string;
        isBundle: boolean;
      }[];
      unitPrice: Prisma.Decimal;
      unitCost: Prisma.Decimal | null;
    }[] = [];

    for (const item of input.items) {
      const sku = await tx.sku.findUnique({
        where: { id: item.skuId },
        include: {
          variant: {
            include: {
              product: true,
              optionValues: { include: { option: true, optionValue: true } },
            },
          },
          bundleComponents: {
            orderBy: { position: 'asc' as const },
            include: {
              componentSku: {
                include: { variant: { include: { product: true } } },
              },
            },
          },
        },
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
        snapshot: buildOrderItemSnapshot(sku),
        isBundle: sku.isBundle,
        bundleSnapshot: this.currentBundleSnapshot(sku, item.quantity),
        components: sku.bundleComponents.map((component) => ({
          componentSkuId: component.componentSkuId,
          quantity: component.quantity,
          skuCode: component.componentSku.skuCode,
          status: component.componentSku.status,
          productStatus: component.componentSku.variant.product.status,
          isBundle: component.componentSku.isBundle,
        })),
        unitPrice: sku.price,
        unitCost: sku.landedCost,
      });
    }

    // Stock validation: any shortfall rejects the whole order. A virtual
    // Bundle line derives its availability from its components' free stock —
    // it has no inventory row of its own.
    const skuIds = [...new Set([
      ...lines.map((line) => line.skuId),
      ...lines.flatMap((line) => line.components.map((component) => component.componentSkuId)),
    ])];
    const availableBySku = await this.inventory.availableBySku(skuIds, tx);

    for (const line of lines) {
      const available = line.isBundle
        ? computeBundleAvailability(line.components.map((component) => ({
            ...component,
            availableInventory: availableBySku.get(component.componentSkuId) ?? 0,
          })))
        : availableBySku.get(line.skuId) ?? 0;
      if (available < line.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${line.skuCode}: available ${available}, requested ${line.quantity}`,
        );
      }
    }

    // Bundle lines share their physical components with the rest of the
    // order, so every per-line check above can pass while the order as a
    // whole over-commits a component. Re-check the aggregate demand of the
    // components a Bundle touches; demand that only ordinary lines create
    // keeps its per-line error above.
    if (lines.some((line) => line.isBundle)) {
      const requirements = cartRequirements(lines.map((line) => ({
        skuId: line.skuId,
        isBundle: line.isBundle,
        quantity: line.quantity,
        components: line.components,
      })));
      for (const requirement of requirements) {
        const available = availableBySku.get(requirement.skuId) ?? 0;
        if (requirement.quantity <= available) continue;
        const owner = lines.find(
          (line) =>
            line.isBundle &&
            line.components.some((component) => component.componentSkuId === requirement.skuId),
        );
        if (!owner) continue;
        const component = owner.components.find(
          (entry) => entry.componentSkuId === requirement.skuId,
        )!;
        throw new BadRequestException(
          `Insufficient stock for ${owner.skuCode}: this order needs ${requirement.quantity} of ${component.skuCode}, but only ${available} are available`,
        );
      }
    }

    // Totals at the actual selling price: order lines already snapshot
    // unitPrice/lineTotal at the selling price, so subtotal = sum of lines.
    // compareAtPrice is merchandising only. The order-level promotion is
    // resolved inside the transaction so its advisory lock protects the
    // count-and-claim operation.
    let subtotal = 0;
    for (const line of lines) {
      subtotal += Number(line.unitPrice) * line.quantity;
    }
    const shippingTotal = 0;

    const orderNumber = await this.nextOrderNumber(tx);
    const warehouse = await this.inventory.defaultWarehouse(tx);

        const touch = await this.marketingTouch.resolve(input.marketingCredential);
        const promo = input.promoCode
          ? await this.promotions.resolveForCheckout(
              tx,
              input.promoCode,
              subtotal,
              normalizedPhone,
            )
          : null;
        const discount = promo ? computeDiscount(promo.rule, subtotal) : 0;
        const grandTotal = subtotal - discount + shippingTotal;

        const created = await tx.order.create({
        data: {
          orderNumber,
          customerId: customer.id,
          customerClassification: classification.classification,
          optimizerId: touch?.ownerUserId ?? null,
          optimizerAidSnapshot: touch?.aid ?? null,
          optimizerNameSnapshot: touch?.ownerName ?? null,
          subtotal: new Prisma.Decimal(subtotal),
          discountTotal: new Prisma.Decimal(discount),
          shippingTotal: new Prisma.Decimal(shippingTotal),
          grandTotal: new Prisma.Decimal(grandTotal),
          preferredDeliveryDate: input.preferredDeliveryDate
            ? new Date(`${input.preferredDeliveryDate}T00:00:00Z`)
            : null,
          customerNote: input.customerNote ?? null,
          promoCode: promo?.code ?? null,
          trackingSessionId: input.trackingSessionId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          idempotencyHash,
          items: {
            create: lines.map((line) => ({
              skuId: line.skuId,
              productId: line.productId,
              variantId: line.variantId,
              productNameSnapshot: line.productName,
              skuCodeSnapshot: line.skuCode,
              variantSnapshot: line.snapshot.variantSnapshot,
              // Option snapshots are written once here (rename immutability);
              // legacy variants leave the column at DB NULL. Prisma's JSON
              // input cannot express JS null, so the key is omitted instead.
              ...(line.snapshot.optionSnapshot
                ? { optionSnapshot: line.snapshot.optionSnapshot }
                : {}),
              // The physical components this line owes are frozen here; the
              // virtual SKU itself is never an inventory demand.
              ...(line.bundleSnapshot ? { bundleSnapshot: line.bundleSnapshot } : {}),
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
              sourceType: touch?.sourceType ?? (input.attribution.sourceType === 'OTHER' ? 'OTHER' : 'ORGANIC'),
              aidSnapshot: touch?.aid ?? null,
              optimizerId: touch?.ownerUserId ?? null,
              ownerNameSnapshot: touch?.ownerName ?? null,
              linkId: touch?.linkId ?? null,
              productId: touch?.productId ?? null,
              productNameSnapshot: touch?.productName ?? null,
              productCodeSnapshot: touch?.productCode ?? null,
              publishedRevision: touch?.publishedRevision ?? null,
              touchedAt: touch ? new Date(touch.touchedAt) : null,
              legacy: touch?.legacy ?? null,
              facebookPostId: touch?.facebookPostId ?? null,
              campaignId: touch?.campaignId ?? null,
              adsetId: touch?.adsetId ?? null,
              adId: touch?.adId ?? null,
              landingPageId: touch?.landingPageId ?? null,
              utmSource: touch?.utmSource ?? null,
              utmMedium: touch?.utmMedium ?? null,
              utmCampaign: touch?.utmCampaign ?? null,
              utmContent: touch?.utmContent ?? null,
              utmTerm: touch?.utmTerm ?? null,
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

      // Claim the slot in the same transaction as the order. A later stock or
      // write failure rolls both rows back together.
      if (promo) {
        await tx.promoCodeRedemption.create({
          data: {
            promotionId: promo.id,
            orderId: created.id,
            codeSnapshot: promo.code,
            normalizedPhone,
            discountAmount: new Prisma.Decimal(discount),
          },
        });
      }

      if (lines.some(line => line.isBundle)) {
        const requirements = aggregateRequirements(lines.flatMap(line =>
          this.lineRequirements(line.skuId, line.bundleSnapshot, line.quantity),
        ));
        await this.reserveRequirementsWithin(tx, requirements, true, warehouse.id, created.id);
      } else {
        for (const line of [...lines].sort((left, right) => left.skuId.localeCompare(right.skuId))) {
          await this.inventory.reserveWithin(tx, line.skuId, warehouse.id, line.quantity, created.id);
        }
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: created.id,
          statusDomain: 'ORDER_STATUS',
          newStatus: 'NEW',
          source: 'SYSTEM',
        },
      });

      return {
        order: created,
        customer,
        orderNumber,
        offerAvailabilityChanged: promo?.exhaustsTotalLimit ?? false,
        // Meta Purchase facts travel out of the transaction so the outbox
        // write happens after the order is committed.
        purchaseLines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          unitPrice: Number(line.unitPrice),
        })),
        // The persisted Decimal(10,2) amount is the single source for the
        // response and the Meta Purchase outbox, so a rounded DB value can
        // never diverge between the browser and server events.
        amount: Number(created.grandTotal),
      };
      });

    const transactionOutcome = await runCheckoutTransaction().catch(
      async (error: unknown) => {
        // Two concurrent retries can both pass the pre-check; the unique key
        // makes one transaction lose. Read the winner back instead of failing.
        if (input.idempotencyKey && idempotencyHash && this.isUniqueViolation(error)) {
          const replay = await this.findIdempotentOrder(input.idempotencyKey, idempotencyHash);
          if (replay) return { replay } as const;
        }
        throw error;
      },
    );
    if ('replay' in transactionOutcome) return transactionOutcome.replay;
    const { order, customer, orderNumber, offerAvailabilityChanged, purchaseLines, amount } = transactionOutcome;

    if (offerAvailabilityChanged) {
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
    }

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

    // Meta Purchase through the durable outbox. The order is already
    // committed; a measurement hiccup must never surface as a checkout error.
    if (requestMeta?.eventSourceUrl) {
      try {
        await this.metaCapi?.enqueuePurchase({
          orderNumber,
          items: purchaseLines,
          value: amount,
          phone: normalizedPhone,
          consent: input.metaConsent === true,
          fbp: input.fbp ?? null,
          fbc: input.fbc ?? null,
          clientIp: requestMeta.clientIp,
          clientUserAgent: requestMeta.clientUserAgent,
          eventSourceUrl: requestMeta.eventSourceUrl,
        });
      } catch {
        // Best effort; the row (when written) is retried by the worker.
      }
    }

    const requiresReview = classification.classification === 'RPT' || classification.classification === 'RECHECK';
    return {
      orderNumber,
      orderStatus: 'NEW',
      confirmationStatus: requiresReview ? 'NEEDS_REVIEW' : 'UNCONFIRMED',
      riskType: requiresReview ? classification.classification : null,
      requiresReview,
      // The same amount written to the order and sent to the Purchase outbox.
      // The confirmation page uses this instead of its cart preview total.
      grandTotal: amount,
    };
  }

  /** Replays a checkout retry, or rejects a key reused with other details. */
  private async findIdempotentOrder(key: string, fingerprint: string) {
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey: key },
      select: {
        orderNumber: true,
        orderStatus: true,
        confirmationStatus: true,
        customerClassification: true,
        grandTotal: true,
        idempotencyHash: true,
      },
    });
    if (!existing) return null;
    if (existing.idempotencyHash !== fingerprint) {
      throw new ConflictException(
        `This checkout was already submitted as order ${existing.orderNumber} with different details. Open that order or start a new checkout.`,
      );
    }
    const requiresReview = existing.confirmationStatus === 'NEEDS_REVIEW';
    return {
      orderNumber: existing.orderNumber,
      orderStatus: existing.orderStatus,
      confirmationStatus: existing.confirmationStatus,
      riskType: requiresReview ? existing.customerClassification : null,
      requiresReview,
      // A replay returns the original order's persisted amount, never a
      // fresh preview or the catalog's current price.
      grandTotal: Number(existing.grandTotal),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  /** §22.1 confirm: only while still unconfirmed and not cancelled. */
  async confirm(
    orderId: string,
    operatorId: string,
    decision?: { decision: 'CONFIRM' | 'CANCEL' | 'REQUEST_INFO'; note?: string },
  ) {
    const { updated, promoReleased, backInStockClaims } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { riskFlags: { where: { resolved: false } } },
      });
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

      // The decision decides what happens. A "CANCEL" decision cancels the
      // order, a "REQUEST_INFO" decision sends it back to the queue - neither
      // of them confirms the order.
      if (decision?.decision === 'CANCEL') {
        return this.applyCancellation(tx, order, operatorId, decision.note);
      }
      if (decision?.decision === 'REQUEST_INFO') {
        const updated = await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: 'QUESTION' },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: 'QUESTION',
            source: 'ADMIN',
            operatorId,
            comment: decision.note ?? 'Requested more information from the customer',
          },
        });
        return { updated, promoReleased: false, backInStockClaims: [] };
      }

      // An unresolved risk flag blocks the confirmation: the duplicate and the
      // recheck decisions have to be made by a human first.
      const unresolved = order.riskFlags ?? [];
      if (unresolved.length > 0) {
        throw new BadRequestException(
          `RISK_FLAG_UNRESOLVED: ${unresolved.map((f) => f.flagType).join(', ')} must be resolved before the order can be confirmed`,
        );
      }

    // The verification checklist is a record of what the operator checked,
    // not a gate: an order may be confirmed with open questions.

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
      return { updated, promoReleased: false, backInStockClaims: [] };
    });
    await this.backInStock.deliverClaims(backInStockClaims);
    if (promoReleased) {
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
    }
    return updated;
  }

  /**
   * The cancellation itself, shared by the cancel endpoint and by a review
   * decision of "CANCEL": the order goes to CANCELLED, the stock reservation
   * and the promo slot are released and the back-in-stock claims come back.
   */
  private async applyCancellation(
    tx: Prisma.TransactionClient,
    order: { id: string; orderStatus: OrderStatus },
    operatorId: string,
    comment?: string,
  ) {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { orderStatus: 'CANCELLED' },
    });
    const backInStockClaims = await this.inventory.releaseForOrder(tx, order.id, {
      claimBackInStock: true,
    });
    const promoReleased = await this.releasePromoSlot(tx, order.id);
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        statusDomain: 'ORDER_STATUS',
        oldStatus: order.orderStatus,
        newStatus: 'CANCELLED',
        source: 'ADMIN',
        operatorId,
        comment: comment ?? null,
      },
    });
    return { updated, promoReleased, backInStockClaims };
  }

  /** §22.2 cancel: allowed until shipping; releases reservations (§31). */
  async cancel(orderId: string, operatorId: string) {
    const { updated, promoReleased, backInStockClaims } =
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');

        const terminal = new Set<OrderStatus>([
          'CANCELLED',
          'DENIED',
          'SIGNED',
          'AFTER_SALES',
        ]);
        if (terminal.has(order.orderStatus)) {
          throw new BadRequestException(
            `Order cannot be cancelled from status ${order.orderStatus}`,
          );
        }
        if (order.orderStatus === 'SHIPPING') {
          throw new BadRequestException('Shipped orders cannot be cancelled');
        }

        const updated = await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: 'CANCELLED' },
        });
        const backInStockClaims = await this.inventory.releaseForOrder(
          tx,
          orderId,
          { claimBackInStock: true },
        );
        const promoReleased = await this.releasePromoSlot(tx, orderId);
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
        return { updated, promoReleased, backInStockClaims };
      },
    );

    await this.backInStock.deliverClaims(backInStockClaims);
    if (promoReleased) {
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
    }
    return updated;
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

  /**
   * Per-status order counts for the workbench tab bar, plus the derived
   * buckets the tabs surface: needsReview (RPT/RECHECK queue) and duplicate
   * (unresolved POSSIBLE_DUPLICATE flags).
   */
  /**
   * The counters of the workbench tab bar.
   *
   * Every number is computed with the filters of the current list, so the
   * tab bar always describes the list the operator is looking at: switching
   * a filter changes the numbers, not only the rows.
   */
  async counts(
    query: OrderQuery = { page: 1, pageSize: 20 },
    currentUserId?: string,
  ) {
    const base = this.buildListWhere(query);
    const bucket = (queue: string) => this.queueWhere(queue, currentUserId);
    const [
      byStatus,
      needsReview,
      duplicate,
      all,
      todo,
      recheck,
      tohandover,
      toship,
      shipping,
      exception,
      signed,
      cods,
      cancelled,
      mine,
    ] = await Promise.all([
      this.prisma.order.groupBy({ by: ['orderStatus'], _count: { _all: true } }),
      this.prisma.order.count({
        where: { AND: [base, { confirmationStatus: 'NEEDS_REVIEW' }] },
      }),
      this.prisma.order.count({
        where: {
          AND: [
            base,
            { riskFlags: { some: { flagType: 'POSSIBLE_DUPLICATE', resolved: false } } },
          ],
        },
      }),
      this.prisma.order.count({ where: base }),
      this.prisma.order.count({ where: { AND: [base, bucket('todo')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('recheck')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('tohandover')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('toship')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('shipping')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('exception')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('signed')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('cods')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('cancelled')] } }),
      this.prisma.order.count({ where: { AND: [base, bucket('mine')] } }),
    ]);
    const statusCounts: Record<string, number> = {};
    for (const row of byStatus) {
      statusCounts[row.orderStatus] = row._count._all;
    }
    return {
      total: all,
      byStatus: statusCounts,
      needsReview,
      duplicate,
      todo,
      recheck,
      tohandover,
      toship,
      shipping,
      exception,
      signed,
      codPending: cods,
      cancelled,
      mine,
      queues: {
        all,
        todo,
        recheck,
        tohandover,
        toship,
        shipping,
        exception,
        signed,
        cods,
        cancelled,
        mine,
      },
    };
  }

  /**
   * Every order of one phone number, with the numbers the workbench needs
   * to judge the customer: how often they sign for an order, what is still
   * on the way, and what was cancelled.
   */
  async customerOrderHistory(phone: string) {
    const orders = await this.prisma.order.findMany({
      where: { customer: { normalizedPhone: phone } },
      include: {
        customer: { select: { name: true } },
        items: {
          select: {
            id: true,
            skuCodeSnapshot: true,
            productNameSnapshot: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
          },
        },
        riskFlags: { where: { resolved: false } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const signed = orders.filter((o) => o.orderStatus === 'SIGNED').length;
    const shipping = orders.filter((o) => o.orderStatus === 'SHIPPING').length;
    const open = orders.filter((o) =>
      ['NEW', 'PENDING', 'QUESTION'].includes(o.orderStatus),
    ).length;
    const confirmed = orders.filter((o) => o.orderStatus === 'CONFIRMED').length;
    const cancelled = orders.filter((o) => o.orderStatus === 'CANCELLED').length;
    const exception = orders.filter(
      (o) => o.orderStatus === 'SHIPPING' && o.riskFlags.length > 0,
    ).length;
    const value = orders.reduce((sum, o) => sum + Number(o.grandTotal ?? 0), 0);
    // The owner (customer-service assignee) of every order, resolved from the
    // users table - the schema stores the id without a relation.
    const assignedIds = [
      ...new Set(orders.map((o) => o.assignedToId).filter((id): id is string => Boolean(id))),
    ];
    const operators = assignedIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: assignedIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(operators.map((u) => [u.id, u.name]));
    return {
      phone,
      customerName: orders[0]?.customer.name ?? null,
      customerClassification: orders[0]?.customerClassification ?? null,
      total: orders.length,
      signed,
      rate: orders.length ? Math.round((signed / orders.length) * 100) : 0,
      shipping,
      open,
      confirmed,
      cancelled,
      exception,
      value,
      lastOrderAt: orders[0]?.createdAt ?? null,
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        orderStatus: o.orderStatus,
        confirmationStatus: o.confirmationStatus,
        paymentStatus: o.paymentStatus,
        grandTotal: o.grandTotal,
        customerClassification: o.customerClassification,
        ownerName: o.assignedToId ? (nameById.get(o.assignedToId) ?? null) : null,
        items: o.items.map((i) => ({
          id: i.id,
          skuCodeSnapshot: i.skuCodeSnapshot,
          productNameSnapshot: i.productNameSnapshot,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
        })),
        riskFlags: o.riskFlags.map((f) => ({ flagType: f.flagType, reason: f.reason })),
      })),
    };
  }

  /** SKU search for manual order entry: sellable SKUs matching name/code. */
  async skuSearch(q: string) {
    const term = q.trim();
    const skus = await this.prisma.sku.findMany({
      where: {
        status: 'ACTIVE',
        price: { not: null },
        variant: { product: { status: 'ACTIVE', ...(term ? { name: { contains: term, mode: 'insensitive' as const } } : {}) } },
      },
      include: { variant: { select: { name: true, product: { select: { name: true } } } } },
      orderBy: { skuCode: 'asc' },
      take: 8,
    });
    return skus.map((sku) => ({
      skuId: sku.id,
      label: `${sku.variant.product.name} — ${sku.variant.name} (${sku.skuCode})`,
      price: sku.price === null ? null : String(sku.price),
      skuCode: sku.skuCode,
    }));
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
    const { updated, promoReleased, backInStockClaims } =
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');

        // The status endpoint only moves an order inside the "in progress"
        // states. CONFIRMED, SHIPPING and CANCELLED each have their own
        // endpoint, because they carry rules (verification, stock, shipment)
        // that a plain status change would walk around.
        const legal: Record<string, OrderStatus[]> = {
          NEW: ['PENDING', 'QUESTION', 'DENIED'],
          PENDING: ['QUESTION', 'DENIED', 'ABNORMAL'],
          QUESTION: ['PENDING', 'DENIED'],
          CONFIRMED: ['AFTER_SALES'],
          ABNORMAL: ['PENDING', 'QUESTION', 'DENIED', 'AFTER_SALES'],
          SHIPPING: ['SIGNED', 'AFTER_SALES'],
          SIGNED: ['AFTER_SALES'],
          CANCELLED: [],
          DENIED: [],
          AFTER_SALES: [],
        };
        const targets = legal[order.orderStatus];
        if (!targets?.includes(status)) {
          const hint =
            status === 'CONFIRMED'
              ? 'use POST /admin/orders/:id/confirm'
              : status === 'SHIPPING'
                ? 'use POST /admin/orders/:id/ship'
                : status === 'CANCELLED'
                  ? 'use POST /admin/orders/:id/cancel'
                  : '';
          throw new BadRequestException(
            `Invalid status transition ${order.orderStatus} -> ${status}${
              hint ? ` (${hint})` : ''
            }`,
          );
        }

        const updated = await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: status },
        });
        const releasesStock = status === 'CANCELLED' || status === 'DENIED';
        const backInStockClaims =
          releasesStock && order.orderStatus !== status
            ? await this.inventory.releaseForOrder(tx, orderId, {
                claimBackInStock: true,
              })
            : [];
        // A pre-shipment cancellation releases the offer. A COD denial or a
        // post-shipment cancellation keeps the redemption in history.
        const promoReleased =
          status === 'CANCELLED' && order.orderStatus !== 'SHIPPING'
            ? await this.releasePromoSlot(tx, orderId)
            : false;
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
        return { updated, promoReleased, backInStockClaims };
      },
    );

    await this.backInStock.deliverClaims(backInStockClaims);
    if (promoReleased) {
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
    }
    return updated;
  }

  /**
   * Edit shipping address snapshot / order items. Item edits adjust inventory
   * reservations per-line (§30–§32) and recompute totals server-side.
   */
  async edit(orderId: string, input: EditOrderInput, operatorId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, shippingAddress: true, shipments: { include: { items: true } } },
      });
      if (!order) throw new NotFoundException('Order not found');
      const terminal = new Set(['CANCELLED', 'DENIED', 'SIGNED', 'AFTER_SALES']);
      if (terminal.has(order.orderStatus)) {
        throw new BadRequestException(`Order ${order.orderStatus} cannot be edited`);
      }
      const warehouse = await this.inventory.defaultWarehouse(tx);
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
        await this.validateStoredBundleLines(tx, order.items);
        const current = new Map(order.items.map(item => [item.id, item]));
        const currentBySku = new Map<string, typeof order.items>();
        for (const item of order.items) {
          const matching = currentBySku.get(item.skuId) ?? [];
          matching.push(item);
          currentBySku.set(item.skuId, matching);
        }
        const next = new Map<string, { skuId: string; quantity: number }>();
        for (const requested of input.items) {
          let existing;
          if (requested.orderItemId) {
            existing = current.get(requested.orderItemId);
            if (!existing || existing.skuId !== requested.skuId) {
              throw new BadRequestException('Order item does not match this order and SKU');
            }
          } else {
            const matching = currentBySku.get(requested.skuId) ?? [];
            if (matching.length > 1) {
              throw new BadRequestException('Ambiguous SKU; specify the order item ID for each historical line');
            }
            existing = matching[0];
          }
          const identity = existing?.id ?? `new:${requested.skuId}`;
          if (next.has(identity)) throw new BadRequestException('Duplicate order item');
          next.set(identity, requested);
        }
        const skuIds = [...new Set([...order.items.map(item => item.skuId), ...input.items.map(item => item.skuId)])];
        const addedSkuIds = [...next].filter(([identity]) => !current.has(identity)).map(([, item]) => item.skuId).sort();
        for (const skuId of addedSkuIds) {
          await tx.$queryRaw`SELECT id FROM skus WHERE id = ${skuId}::uuid AND is_bundle = TRUE FOR UPDATE`;
        }
        const skus = await tx.sku.findMany({
          where: { id: { in: skuIds } },
          include: {
            variant: {
              include: {
                product: true,
                optionValues: { include: { option: true, optionValue: true } },
              },
            },
            bundleComponents: {
              orderBy: { position: 'asc' as const },
              include: {
                componentSku: {
                  include: { variant: { include: { product: true } } },
                },
              },
            },
          },
        });
        const skuById = new Map(skus.map((s) => [s.id, s]));
        const bundleOrder = order.items.some(item => item.bundleSnapshot != null) || skus.some(sku => sku.isBundle);
        const shippedByLine = new Map<string, number>();
        if (bundleOrder) {
          for (const shipment of order.shipments) {
            for (const item of shipment.items) {
              shippedByLine.set(item.orderItemId, (shippedByLine.get(item.orderItemId) ?? 0) + item.quantity);
            }
          }
          if (order.items.some(item => (next.get(item.id)?.quantity ?? 0) < (shippedByLine.get(item.id) ?? 0))) {
            throw new BadRequestException('Order item quantity cannot be less than the quantity already shipped');
          }
          const physicalIds = new Set(order.items.flatMap(item =>
            this.lineRequirements(item.skuId, item.bundleSnapshot, 1).map(requirement => requirement.skuId),
          ));
          for (const [identity, item] of next) {
            if (current.has(identity)) continue;
            const sku = skuById.get(item.skuId);
            if (!sku || sku.status !== 'ACTIVE' || sku.variant.product.status !== 'ACTIVE') {
              throw new BadRequestException(`SKU ${item.skuId} is not available`);
            }
            for (const requirement of this.lineRequirements(sku.id, this.currentBundleSnapshot(sku, item.quantity), 1)) {
              physicalIds.add(requirement.skuId);
            }
          }
          if (physicalIds.size > 0) {
            await tx.$queryRaw`
              SELECT id FROM inventory
              WHERE sku_id IN (${Prisma.join([...physicalIds].sort().map(id => Prisma.sql`${id}::uuid`))})
              ORDER BY sku_id, warehouse_id FOR UPDATE
            `;
          }
        }
        const rebuildReservations = bundleOrder && order.items.some(item =>
          !next.has(item.id) || next.get(item.id)!.quantity < item.quantity,
        );
        const pendingRequirements: BundleRequirement[] = [];
        if (rebuildReservations) await this.inventory.releaseForOrder(tx, orderId);

        // Removed lines: delete + release reservation.
        for (const [identity, item] of current) {
          if (next.has(identity)) continue;
          await tx.orderItem.delete({ where: { id: item.id } });
          if (!bundleOrder) await this.inventory.releaseForOrder(tx, orderId);
        }
        // Quantity changes: diff reservation.
        for (const [identity, { skuId, quantity: qty }] of next) {
          const existing = current.get(identity);
          if (!existing) {
            // New line: validate and reserve.
            const sku = skuById.get(skuId);
            if (!sku || sku.status !== 'ACTIVE' || sku.variant.product.status !== 'ACTIVE') {
              throw new BadRequestException(`SKU ${skuId} is not available`);
            }
            if (sku.price === null) {
              throw new BadRequestException(`SKU ${sku.skuCode} is not priced`);
            }
            const snapshot = buildOrderItemSnapshot(sku);
            const bundleSnapshot = this.currentBundleSnapshot(sku, qty);
            const requirements = this.lineRequirements(skuId, bundleSnapshot, qty);
            await tx.orderItem.create({
              data: {
                orderId,
                skuId,
                productId: sku.variant.productId,
                variantId: sku.variant.id,
                productNameSnapshot: sku.variant.product.name,
                skuCodeSnapshot: sku.skuCode,
                variantSnapshot: snapshot.variantSnapshot,
                ...(snapshot.optionSnapshot
                  ? { optionSnapshot: snapshot.optionSnapshot }
                  : {}),
                ...(bundleSnapshot ? { bundleSnapshot } : {}),
                quantity: qty,
                unitPrice: sku.price,
                unitDiscount: new Prisma.Decimal(0),
                unitCostSnapshot: sku.landedCost,
                lineTotal: new Prisma.Decimal(Number(sku.price) * qty),
              },
            });
            if (bundleOrder) {
              pendingRequirements.push(...requirements);
            } else {
              await this.reserveRequirementsWithin(tx, requirements, false, warehouse.id, orderId);
            }
            continue;
          }
          const outstanding = qty - (shippedByLine.get(existing.id) ?? 0);
          if (existing.quantity === qty) {
            if (rebuildReservations && outstanding > 0) pendingRequirements.push(...this.lineRequirements(skuId, existing.bundleSnapshot, outstanding));
            continue;
          }
          const delta = qty - existing.quantity;
          const reservationQuantity = rebuildReservations ? outstanding : delta <= 0 ? qty : delta;
          const requirements = reservationQuantity === 0 ? [] : this.lineRequirements(
            skuId,
            existing.bundleSnapshot,
            reservationQuantity,
          );
          const frozen = readBundleSnapshot(existing.bundleSnapshot);
          await tx.orderItem.update({
            where: { id: existing.id },
            data: {
              quantity: qty,
              lineTotal: new Prisma.Decimal(Number(existing.unitPrice) * qty),
              ...(frozen ? { bundleSnapshot: {
                ...frozen,
                components: frozen.components.map(component => ({ ...component, totalQuantity: component.quantity * qty })),
              } } : {}),
            },
          });
          if (bundleOrder) {
            pendingRequirements.push(...requirements);
          } else {
            if (delta <= 0) await this.inventory.releaseForOrder(tx, orderId);
            await this.reserveRequirementsWithin(tx, requirements, false, warehouse.id, orderId);
          }
        }
        if (bundleOrder) {
          await this.reserveRequirementsWithin(tx, aggregateRequirements(pendingRequirements), true, warehouse.id, orderId);
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
    });
    return this.get(orderId);
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
    const { keptId, promoReleased } = await this.prisma.$transaction(async (tx) => {
    for (const orderId of [...new Set([input.primaryOrderId, input.mergedOrderId])].sort()) {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    }
    const primary = await tx.order.findUnique({
      where: { id: input.primaryOrderId },
      include: { shippingAddress: true, items: true },
    });
    const merged = await tx.order.findUnique({
      where: { id: input.mergedOrderId },
      include: { shippingAddress: true, items: true },
    });
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

      await this.validateStoredBundleLines(tx, [...kept.items, ...dropped.items]);
      const bundleOrder = [...kept.items, ...dropped.items].some(item => item.bundleSnapshot != null);
      const mergeTargets = [...kept.items];
      // Move merged items into the kept order.
      for (const item of dropped.items) {
        const existing = mergeTargets.find(
          (k) =>
            k.skuId === item.skuId &&
            k.unitPrice.equals(item.unitPrice) &&
            // Bundle lines collapse only when their frozen definitions match:
            // two lines owing different components stay separate lines.
            sameBundleSnapshot(k.bundleSnapshot, item.bundleSnapshot),
        );
        if (existing) {
          const quantity = existing.quantity + item.quantity;
          const frozen = readBundleSnapshot(existing.bundleSnapshot);
          const updated = await tx.orderItem.update({
            where: { id: existing.id },
            data: {
              quantity,
              lineTotal: existing.lineTotal.add(item.lineTotal),
              // The per-line totals follow the line quantity, not the
              // definition, so they are restated for the collapsed line.
              ...(frozen
                ? {
                    bundleSnapshot: {
                      ...frozen,
                      components: frozen.components.map((component) => ({
                        ...component,
                        totalQuantity: component.quantity * quantity,
                      })),
                    },
                  }
                : {}),
            },
          });
          if (bundleOrder) mergeTargets[mergeTargets.indexOf(existing)] = updated;
        } else {
          const moved = await tx.orderItem.update({
            where: { id: item.id },
            data: { orderId: kept.id },
          });
          if (bundleOrder) mergeTargets.push(moved);
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

      if (bundleOrder) {
        await tx.inventoryReservation.updateMany({
          where: { orderId: dropped.id, status: 'ACTIVE' },
          data: { orderId: kept.id },
        });
      } else {
        await this.inventory.releaseForOrder(tx, dropped.id);
      }
      await tx.order.update({
        where: { id: dropped.id },
        data: { orderStatus: 'CANCELLED' },
      });
      const promoReleased = await this.releasePromoSlot(tx, dropped.id);

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

      return { keptId: kept.id, promoReleased };
      },
    );
    if (promoReleased) {
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
    }
    return this.get(keptId);
  }

  private buildListWhere(query: OrderQuery): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (query.status) {
      where.orderStatus =
        query.status.length === 1 ? query.status[0]! : { in: query.status };
    }
    if (query.paymentStatus) {
      where.paymentStatus =
        query.paymentStatus.length === 1
          ? query.paymentStatus[0]!
          : { in: query.paymentStatus };
    }
    if (query.classification) where.customerClassification = query.classification;
    if (query.confirmation) where.confirmationStatus = query.confirmation;
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
      // From/To are Manila calendar days — the day the operator lives in — and
      // the window is half-open, so an order placed at 00:30 Manila belongs to
      // that Manila day. The dashboard counts the same days, which is what
      // makes a tile's drill-down land on exactly the orders it counted.
      where.createdAt = {
        gte: query.dateFrom ? manilaDayStart(query.dateFrom) : undefined,
        lt: query.dateTo ? manilaDayEndExclusive(query.dateTo) : undefined,
      };
    }
    // The customer phone is an exact match: the customer history opens with
    // it and a partial number would mix two customers.
    if (query.phone) {
      where.customer = { normalizedPhone: query.phone };
    }
    // The product filter looks at the SKU snapshot of the order lines.
    if (query.sku) {
      where.items = {
        some: {
          OR: [
            { skuCodeSnapshot: { contains: query.sku, mode: 'insensitive' } },
            { productNameSnapshot: { contains: query.sku, mode: 'insensitive' } },
          ],
        },
      };
    }
    // Payment method: the first payment row of the order.
    if (query.payment) {
      where.payments = { some: { method: query.payment } };
    }
    // Region: city or province of the shipping snapshot.
    if (query.region) {
      where.shippingAddress = {
        is: {
          OR: [
            { city: { contains: query.region, mode: 'insensitive' } },
            { province: { contains: query.region, mode: 'insensitive' } },
          ],
        },
      };
    }
    // The verification filters all talk about the open assignment.
    const verificationFilter: Prisma.OrderVerificationAssignmentWhereInput = { closedAt: null };
    let filterVerification = false;
    if (query.priority) {
      verificationFilter.priority = query.priority;
      filterVerification = true;
    }
    if (query.verification) {
      filterVerification = true;
      if (query.verification === 'none') {
        where.verificationAssignments = { none: { closedAt: null } };
        filterVerification = false;
      } else {
        const status: Prisma.EnumVerificationItemStatusFilter<"OrderVerificationItem"> =
          query.verification === 'pending'
            ? { equals: 'PENDING' }
            : query.verification === 'problem'
              ? { equals: 'PROBLEM' }
              : query.verification === 'open'
                ? { in: ['PENDING', 'PROBLEM'] }
                : { equals: 'DONE' };
        verificationFilter.items = { some: { status } };
      }
    }
    if (query.followUp) {
      const now = new Date();
      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 59, 999);
      const endOfWeek = new Date(now);
      endOfWeek.setDate(endOfWeek.getDate() + 7);
      const until = query.followUp === 'overdue' ? now : query.followUp === 'today' ? endOfToday : endOfWeek;
      verificationFilter.nextFollowUpAt = { lte: until };
      filterVerification = true;
    }
    if (filterVerification) {
      where.verificationAssignments = { some: verificationFilter };
    }

    return where;
  }

  /**
   * The bucket of one work queue (the tabs of the workbench). The counters
   * and the list use the same definition, so a tab never shows a number that
   * the list cannot deliver.
   */
  private queueWhere(queue: string, assigneeId?: string): Prisma.OrderWhereInput {
    switch (queue) {
      case 'todo':
        return {
          orderStatus: { in: ['NEW', 'PENDING', 'QUESTION'] },
          confirmationStatus: { not: 'CONFIRMED' },
        };
      case 'recheck':
        return { customerClassification: { in: ['RPT', 'RECHECK'] } };
      case 'tohandover':
        return { orderStatus: 'CONFIRMED', handoverCompletedAt: null };
      case 'toship':
        return { orderStatus: 'CONFIRMED', handoverCompletedAt: { not: null } };
      case 'shipping':
        return { orderStatus: 'SHIPPING' };
      case 'exception':
        // A box that failed delivery (or is coming back) is an exception until
        // it is actually signed; unresolved risk flags stay on the same queue.
        return {
          orderStatus: 'SHIPPING',
          OR: [
            { riskFlags: { some: { resolved: false } } },
            {
              shipments: {
                some: {
                  status: 'SHIPPING',
                  events: {
                    some: {
                      normalizedStatus: { in: ['FAILED_DELIVERY', 'RETURNING'] },
                    },
                  },
                },
              },
            },
          ],
        };
      case 'signed':
        return { orderStatus: 'SIGNED' };
      case 'cods':
        return { orderStatus: 'SIGNED', paymentStatus: { not: 'SETTLED' } };
      case 'cancelled':
        return { orderStatus: { in: ['CANCELLED', 'DENIED'] } };
      case 'mine':
        return assigneeId
          ? {
              verificationAssignments: {
                some: {
                  closedAt: null,
                  assigneeId,
                  items: { some: { status: { in: ['PENDING', 'PROBLEM'] } } },
                },
              },
            }
          : { orderStatus: { in: [] } };
      default:
        return {};
    }
  }

  async list(query: OrderQuery, currentUserId?: string) {
    const base = this.buildListWhere(query);
    // The tab of the workbench selects a bucket of the queue; it is combined
    // with the filters, never with them.
    const where: Prisma.OrderWhereInput = query.queue
      ? { AND: [base, this.queueWhere(query.queue, currentUserId ?? query.assignedTo)] }
      : base;

    const orderBy =
      query.sort === 'newest'
        ? { createdAt: 'desc' as const }
        : query.sort === 'verify'
          ? { verificationAssignments: { _count: 'asc' as const } }
          : { createdAt: 'asc' as const };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          customer: true,
          // unitPrice is what the table shows as the sold price; shipping
          // stays a cost and never enters the consumer total.
          items: {
            select: {
              id: true,
              skuCodeSnapshot: true,
              productNameSnapshot: true,
              variantSnapshot: true,
              variantId: true,
              optionSnapshot: true,
              quantity: true,
              lineTotal: true,
              unitPrice: true,
              // The line's photo, resolved exactly like the guest order page:
              // current product media, matched to the ordered option value.
              sku: {
                select: {
                  product: {
                    select: {
                      images: {
                        where: { type: 'IMAGE' as const },
                        orderBy: { sortOrder: 'asc' as const },
                        select: {
                          url: true,
                          variantId: true,
                          optionValueId: true,
                          isScene: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          riskFlags: { where: { resolved: false } },
          shippingAddress: true,
          // The payment method of the order (the first payment row).
          payments: {
            select: { method: true, status: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
          verificationAssignments: {
            where: { closedAt: null },
            select: {
              id: true,
              assigneeId: true,
              priority: true,
              nextFollowUpAt: true,
              items: {
                select: {
                  id: true,
                  itemKey: true,
                  titleSnapshot: true,
                  required: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy,
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
      // The table shows a photo per line; the nested product rows never leave
      // the admin API, only the flat URL below does.
      items: o.items.map((item) => {
        const { sku: _sku, ...rest } = item;
        return { ...rest, thumbnailUrl: guestThumbnail(item) };
      }),
      // The payment method (COD / online) the table filters on.
      paymentMethod: o.payments?.[0]?.method ?? null,
      assignedTo: o.assignedToId ? { id: o.assignedToId, name: nameById.get(o.assignedToId) ?? null } : null,
      // The verification progress the table shows under the status.
      verification: verificationSummary(o.verificationAssignments),
    }));

    return { items: enriched, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Whether the recorded handover events cover every ordered unit. The
   * `handover_completed_at` column is a cache of this answer.
   */
  private async handoverCoversEveryLine(
    tx: Pick<Prisma.TransactionClient, 'orderHandoverEvent'>,
    orderId: string,
    lines: { id: string; quantity: number }[],
  ): Promise<boolean> {
    const events = await tx.orderHandoverEvent.findMany({ where: { orderId } });
    const totals = new Map<string, number>();
    for (const event of events) {
      if (event.type !== 'HANDED_OVER') continue;
      for (const item of (event.items as { orderItemId: string; quantity: number }[] | null) ??
        []) {
        totals.set(item.orderItemId, (totals.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }
    return (
      lines.length > 0 && lines.every((line) => (totals.get(line.id) ?? 0) >= line.quantity)
    );
  }

  /**
   * Warehouse shipping action (API_SPEC §22.3, DATABASE §61-63, §69).
   * Ships a subset of the order's lines as one shipment; partial shipments are
   * allowed, so the order may stay SHIPPING while more boxes are created.
   *
   * Gates (CUSTOMER_RISK_SPEC §17 + workbench §6.1): only CONFIRMED/SHIPPING
   * orders with confirmationStatus CONFIRMED ship, and no unresolved
   * RECHECK/POSSIBLE_DUPLICATE flag may remain. Over-shipping a line (beyond
   * quantity minus what earlier shipments already covered) is rejected.
   */
  async ship(orderId: string, input: ShipOrderInput, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        shipments: { include: { items: true } },
        riskFlags: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const legal = new Set<OrderStatus>(['CONFIRMED', 'SHIPPING']);
    if (!legal.has(order.orderStatus)) {
      throw new BadRequestException(
        `Only confirmed orders can be shipped (current: ${order.orderStatus})`,
      );
    }
    if (order.confirmationStatus !== 'CONFIRMED') {
      throw new BadRequestException(
        'Order must be confirmation-confirmed before shipping',
      );
    }
    if (order.orderStatus === 'CONFIRMED' && !order.handoverCompletedAt) {
      // The flag is derived from the append-only handover events, so it can
      // lag behind rows recorded before it existed. The events decide.
      const covered = await this.handoverCoversEveryLine(tx, order.id, order.items);
      if (!covered) {
        throw new BadRequestException(
          'Handover is not complete: every order line must be handed over to the warehouse before shipping',
        );
      }
      await tx.order.update({
        where: { id: order.id },
        data: { handoverCompletedAt: new Date() },
      });
    }
    const blocking = order.riskFlags.filter(
      (f) =>
        !f.resolved &&
        (f.flagType === 'CUSTOMER_RECHECK' || f.flagType === 'POSSIBLE_DUPLICATE'),
    );
    if (blocking.length > 0) {
      throw new BadRequestException(
        `Unresolved risk flag${blocking.length > 1 ? 's' : ''} block shipping: ${blocking
          .map((f) => f.flagType)
          .join(', ')}`,
      );
    }

    await this.validateStoredBundleLines(tx, order.items);
    // Per-line: shippedLine must fit within the line quantity minus what
    // previous shipments already boxed (multiple packages per order, §61).
    const shippedByLine = new Map<string, number>();
    for (const shipment of order.shipments) {
      for (const item of shipment.items) {
        shippedByLine.set(item.orderItemId, (shippedByLine.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }
    const lineById = new Map(order.items.map((i) => [i.id, i]));
    if (order.items.some(line => line.bundleSnapshot != null) && new Set(input.items.map(item => item.orderItemId)).size !== input.items.length) {
      throw new BadRequestException('Duplicate shipment order item IDs are not allowed');
    }
    for (const item of input.items) {
      const line = lineById.get(item.orderItemId);
      if (!line) {
        throw new BadRequestException(`Order line ${item.orderItemId} does not belong to this order`);
      }
      const already = shippedByLine.get(line.id) ?? 0;
      const remaining = line.quantity - already;
      if (item.quantity > remaining) {
        throw new BadRequestException(
          `Cannot ship ${item.quantity} of ${line.skuCodeSnapshot}: only ${remaining} remains`,
        );
      }
    }

    // Aggregate the reservation consumption per SKU. A Bundle line consumes
    // the physical components its snapshot froze, never the virtual SKU.
    const bySku = new Map<string, number>();
    for (const item of input.items) {
      const line = lineById.get(item.orderItemId)!;
      for (const requirement of this.lineRequirements(line.skuId, line.bundleSnapshot, item.quantity)) {
        bySku.set(requirement.skuId, (bySku.get(requirement.skuId) ?? 0) + requirement.quantity);
      }
    }

    const warehouse = await this.inventory.defaultWarehouse(tx);
      const shipment = await tx.shipment.create({
        data: {
          orderId,
          warehouseId: warehouse.id,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber ?? null,
          shippedAt: new Date(),
          createdBy: operatorId,
          items: {
            create: input.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantity,
            })),
          },
        },
      });

      const physicalRequirements = order.items.some(line => line.bundleSnapshot != null)
        ? new Map([...bySku].sort(([left], [right]) => left.localeCompare(right)))
        : bySku;
      await this.inventory.consumeForOrder(tx, orderId, physicalRequirements);

      // First shipment of a confirmed order flips it to SHIPPING; later
      // partial shipments leave it as is (§69 until every box is signed).
      let orderStatus = order.orderStatus;
      if (orderStatus !== 'SHIPPING') {
        orderStatus = 'SHIPPING';
        await tx.order.update({
          where: { id: orderId },
          data: { orderStatus },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: 'SHIPPING',
            source: 'ADMIN',
            operatorId,
            comment: `Shipped via ${input.carrier}${input.trackingNumber ? ` · ${input.trackingNumber}` : ''}`,
          },
        });
      }

      await tx.orderNote.create({
        data: {
          orderId,
          userId: operatorId,
          noteType: 'WAREHOUSE',
          content: `Shipped via ${input.carrier}${input.trackingNumber ? ` · tracking ${input.trackingNumber}` : ''} (${input.items.reduce((s, i) => s + i.quantity, 0)} item(s))`,
        },
      });

      return { shipmentId: shipment.id, orderStatus, confirmationStatus: order.confirmationStatus };
    });
  }

  /** §69 sign a shipment: every box signed moves the order to SIGNED. */
  async sign(orderId: string, shipmentId: string, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize with return acceptance on the same order: a box cannot be
      // signed and accepted back at the same time.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          shipments: { include: { items: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const shipment = order.shipments.find((s) => s.id === shipmentId);
      if (!shipment) {
        throw new NotFoundException('Shipment not found on this order');
      }
      if (shipment.status === 'SIGNED') {
        throw new BadRequestException('Shipment is already signed');
      }
      if (shipment.status === 'RETURNED' || shipment.status === 'PARTIALLY_RETURNED') {
        throw new BadRequestException(
          `Shipment was already returned; its goods cannot be signed (current: ${shipment.status})`,
        );
      }
      if (order.orderStatus !== 'SHIPPING') {
        throw new BadRequestException(`Order is ${order.orderStatus}; only SHIPPING orders can be signed`);
      }

      // Some units of this box may already be back in the warehouse. Signing
      // covers whatever is left; a fully returned box is refused above.
      const acceptedInBox = new Map<string, number>();
      for (const item of await tx.returnAcceptanceItem.findMany({
        where: { acceptance: { orderId, shipmentId } },
        select: { orderItemId: true, quantityGood: true, quantityDamaged: true },
      })) {
        acceptedInBox.set(
          item.orderItemId,
          (acceptedInBox.get(item.orderItemId) ?? 0) +
            item.quantityGood +
            item.quantityDamaged,
        );
      }
      const hasReturnedUnits = [...acceptedInBox.values()].some((quantity) => quantity > 0);
      const shipmentStatus = hasReturnedUnits ? 'PARTIALLY_RETURNED' : 'SIGNED';

      await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: shipmentStatus, signedAt: new Date() },
      });

      const shipments: ShipmentSnapshot[] = order.shipments.map((box) => ({
        id: box.id,
        status: box.id === shipmentId ? shipmentStatus : box.status,
        items: box.items,
      }));
      const shippedByLine = new Map<string, number>();
      for (const box of shipments) {
        for (const [orderItemId, quantity] of quantityByLine(box.items)) {
          shippedByLine.set(orderItemId, (shippedByLine.get(orderItemId) ?? 0) + quantity);
        }
      }
      // A partial shipment may not cover the whole order yet: only a fully
      // shipped order can reach a terminal status.
      const fullyShipped = order.items.every(
        (line) => (shippedByLine.get(line.id) ?? 0) >= line.quantity,
      );
      const orderStatus = orderStatusAfterSign({
        lines: order.items,
        shipments,
        fullyShipped,
      });
      if (orderStatus !== order.orderStatus) {
        await tx.order.update({ where: { id: orderId }, data: { orderStatus } });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: orderStatus,
            source: 'ADMIN',
            operatorId,
            comment: hasReturnedUnits
              ? 'Remaining goods signed; some units were returned'
              : 'All shipments signed',
          },
        });
      }

      await tx.orderNote.create({
        data: {
          orderId,
          userId: operatorId,
          noteType: 'WAREHOUSE',
          content: `Shipment signed (${shipment.carrier}${shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''})`,
        },
      });

      return { shipmentId, orderStatus, shipmentStatus };
    });
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
      // The same verification progress the list shows.
      verification: verificationSummary(order.verificationAssignments),
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
  /**
   * Guest order lookup. The shopper may give EITHER the order number OR the
   * mobile number — one of them is enough:
   *
   * - both → the strict, verified path (the phone must match the order).
   * - mobile number only → the phone IS the identity proof: the most recent
   *   order for that number comes back, with the other orders on the same
   *   number listed beside it so the shopper can pick one.
   * - order number only → a 6-digit sequential number is guessable, so the
   *   personal fields (name, phone, delivery address) stay hidden until the
   *   shopper also proves the mobile number.
   *
   * Every failure path resolves to one uniform 404 so the response can never
   * reveal whether an order exists.
   */
  /**
   * Guest order lookup. The shopper may give EITHER the order number OR the
   * mobile number — one of them is enough:
   *
   * - mobile number only → the phone IS the identity proof: every order on
   *   that number comes back (latest first) so the shopper can open any of
   *   them without searching again.
   * - order number (+ phone) → the matching order. Without the phone the
   *   personal fields (name, phone, delivery address) are withheld: a
   *   6-digit sequential number is guessable, so it must not hand them out.
   *
   * Every failure path resolves to one uniform 404 so the response can never
   * reveal whether an order exists.
   */
  async lookup(orderNumber?: string | null, phone?: string | null) {
    const notFound = () =>
      new NotFoundException(
        'Order not found. Check your order number or mobile number.',
      );

    const wantedOrder = orderNumber?.trim() || null;
    const wantedPhone = phone?.trim() || null;
    if (!wantedOrder && !wantedPhone) throw notFound();

    if (wantedOrder) {
      const order = await this.prisma.order.findUnique({
        where: { orderNumber: wantedOrder },
        include: GUEST_ORDER_INCLUDE,
      });
      if (!order) throw notFound();

      if (!wantedPhone) {
        // Order number alone: personal fields withheld.
        return {
          matchedBy: 'orderNumber' as const,
          personalDetailsIncluded: false,
          orders: [
            {
              ...this.guestOrder(order),
              customer: {
                id: order.customer.id,
                name: null,
                normalizedPhone: null,
                email: null,
              },
              shippingAddress: null,
            },
          ],
        };
      }

      // Both given: the phone has to match this very order.
      if (!this.guestPhoneMatches(order, wantedPhone)) throw notFound();
      return {
        matchedBy: 'orderNumber' as const,
        personalDetailsIncluded: true,
        orders: [this.guestOrder(order)],
      };
    }

    // Mobile number only: the phone is the identity proof.
    if (!wantedPhone) throw notFound();
    const normalized = this.normalizeGuestPhone(wantedPhone);
    if (!normalized) throw notFound();
    const candidates = await this.prisma.order.findMany({
      where: this.guestPhoneFilter(normalized),
      include: GUEST_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const orders = candidates
      .filter((order) => this.guestPhoneMatches(order, wantedPhone))
      .slice(0, 5);
    if (orders.length === 0) throw notFound();
    return {
      matchedBy: 'phone' as const,
      personalDetailsIncluded: true,
      orders: orders.map((order) => this.guestOrder(order)),
    };
  }

  /**
   * The guest view of one order: every line carries the photo the shopper
   * bought, and the product rows behind them are dropped from the response.
   */
  private guestOrder<T extends {
    items: Array<{
      optionSnapshot: unknown;
      variantId: string | null;
      sku: {
        product: {
          slug: string;
          status: string;
          images: Array<{
            url: string;
            variantId: string | null;
            optionValueId: string | null;
            isScene: boolean;
          }>;
        } | null;
      } | null;
    }>;
  }>(order: T) {
    return {
      ...order,
      items: order.items.map((item) => {
        // The nested product rows never reach the guest - only the flat
        // fields below do.
        const { sku: _sku, ...rest } = item;
        return {
          ...rest,
          thumbnailUrl: guestThumbnail(item),
          // The product page of that line, but only while the product is on
          // sale - a line whose product left the catalog has no page to go to.
          productSlug:
            item.sku?.product?.status === 'ACTIVE'
              ? (item.sku.product.slug ?? null)
              : null,
        };
      }),
    };
  }

  /** The shared util returns null for unparseable input; never a 400 here. */
  private normalizeGuestPhone(phone: string): string | null {
    try {
      return normalizePhilippinePhone(phone);
    } catch {
      return null;
    }
  }

  /** True when this phone is the order's customer phone or address phone. */
  private guestPhoneMatches(
    order: {
      customer: { normalizedPhone: string | null } | null;
      shippingAddress: { phone: string | null } | null;
    },
    phone: string,
  ): boolean {
    const queryPhone = this.normalizeGuestPhone(phone);
    if (!queryPhone) return false;
    const customerPhone = order.customer?.normalizedPhone ?? null;
    const snapshotPhone = order.shippingAddress?.phone
      ? this.normalizeGuestPhone(order.shippingAddress.phone)
      : null;
    return queryPhone === customerPhone || queryPhone === snapshotPhone;
  }

  /**
   * Orders whose customer record carries this number, plus the raw address
   * phone forms as a fallback for orders whose customer record was updated
   * after checkout. The caller re-checks every row by normalized number.
   */
  private guestPhoneFilter(normalized: string) {
    const digits = normalized.replace(/^\+63/, '');
    const forms = [normalized, `63${digits}`, `0${digits}`, digits];
    return {
      OR: [
        { customer: { is: { normalizedPhone: normalized } } },
        { shippingAddress: { is: { phone: { in: forms } } } },
      ],
    };
  }

  private async validateStoredBundleLines(
    tx: Prisma.TransactionClient,
    lines: readonly { skuId: string; quantity: number; bundleSnapshot?: unknown }[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const snapshots = lines.map(line => readBundleSnapshot(line.bundleSnapshot));
    const skuIds = [...new Set([
      ...lines.map(line => line.skuId),
      ...snapshots.flatMap(snapshot => snapshot?.components.map(component => component.componentSkuId) ?? []),
    ])];
    const virtualSkus = await tx.sku.findMany({
      where: { id: { in: skuIds }, isBundle: true },
      select: { id: true, isBundle: true },
    });
    const virtualIds = new Set(virtualSkus.filter(sku => sku.isBundle).map(sku => sku.id));
    if (lines.some((line, index) => {
      const snapshot = snapshots[index];
      if (!snapshot) return line.bundleSnapshot != null || virtualIds.has(line.skuId);
      return !virtualIds.has(line.skuId) || snapshot.bundleSkuId !== line.skuId || snapshot.components.some(component =>
        virtualIds.has(component.componentSkuId) || component.totalQuantity !== component.quantity * line.quantity,
      );
    })) {
      throw new BadRequestException('This Bundle line snapshot is unreadable; restore its recorded definition before continuing.');
    }
  }

  /**
   * Freezes the current definition for a new Bundle line, refusing a Bundle
   * that is not sellable. Ordinary SKUs snapshot as null.
   */
  private currentBundleSnapshot(
    sku: SkuWithBundleComponents,
    quantity: number,
  ): OrderBundleSnapshotV1 | null {
    if (!sku.isBundle) return null;
    const reason = validateBundleDefinition(
      sku.bundleComponents.map((component) => ({
        componentSkuId: component.componentSkuId,
        quantity: component.quantity,
        status: component.componentSku.status,
        productStatus: component.componentSku.variant.product.status,
        isBundle: component.componentSku.isBundle,
      })),
    );
    if (reason !== null) {
      throw new BadRequestException(`Bundle ${sku.skuCode} is not available for purchase`);
    }
    return buildBundleSnapshot({
      skuId: sku.id,
      skuCode: sku.skuCode,
      quantity,
      components: sku.bundleComponents,
    });
  }

  /**
   * Physical demand of one stored line. Bundle lines follow their frozen
   * snapshot, never the current definition, so a later redefinition cannot
   * change what an existing order owes. An unreadable snapshot refuses the
   * operation instead of silently demanding nothing.
   */
  private lineRequirements(
    skuId: string,
    bundleSnapshot: unknown,
    quantity: number,
  ): BundleRequirement[] {
    if (bundleSnapshot == null) return [{ skuId, quantity }];
    const snapshot = readBundleSnapshot(bundleSnapshot);
    if (snapshot === null) {
      throw new BadRequestException(
        'This Bundle line snapshot is unreadable; restore its recorded definition before continuing.',
      );
    }
    return requirementsFromBundleSnapshot(snapshot, quantity);
  }

  private async reserveRequirementsWithin(
    tx: Prisma.TransactionClient,
    requirements: readonly BundleRequirement[],
    conditional: boolean,
    warehouseId: string,
    orderId: string,
  ): Promise<void> {
    for (const requirement of requirements) {
      if (conditional) {
        await this.inventory.reserveConditionalWithin(
          tx,
          requirement.skuId,
          warehouseId,
          requirement.quantity,
          orderId,
        );
      } else {
        await this.inventory.reserveWithin(
          tx,
          requirement.skuId,
          warehouseId,
          requirement.quantity,
          orderId,
        );
      }
    }
  }

  private async releasePromoSlot(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<boolean> {
    const changed = await tx.$executeRaw`
      UPDATE promo_code_redemptions SET released_at = now()
      WHERE order_id = ${orderId}::uuid AND released_at IS NULL
    `;
    return changed > 0;
  }

  private normalizePhone(phone: string): string {
    const normalized = normalizePhilippinePhone(phone);
    if (!normalized) {
      throw new BadRequestException(`Invalid Philippine phone number: "${phone}"`);
    }
    return normalized;
  }

  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('order_number_seq') AS nextval
    `;
    return `PH${rows[0].nextval}`;
  }
}
