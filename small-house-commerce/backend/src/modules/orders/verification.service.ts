import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  VERIFICATION_LIBRARY,
  VERIFICATION_TEMPLATES,
  verificationItemByKey,
  type VerificationCategory,
} from './verification-library.js';
import {
  subjectFingerprint,
  type VerificationFingerprintInput,
} from './verification-fingerprint.js';
import type {
  AssignVerificationInput,
  ContactAttemptInput,
  CreateVerificationTemplateInput,
  SetVerificationResultInput,
} from './dto/verification.dto.js';

/**
 * The order facts a verification result depends on. Kept in one place so the
 * fingerprint of an item and the fingerprint computed at edit time always
 * look at the same facts.
 */
export const VERIFICATION_ORDER_INCLUDE = {
  customer: { select: { normalizedPhone: true, name: true } },
  shippingAddress: true,
  items: { select: { id: true, skuCodeSnapshot: true, quantity: true } },
  riskFlags: { where: { resolved: false }, select: { flagType: true } },
} as const;

type OrderWithVerificationFacts = {
  id: string;
  subtotal: unknown;
  discountTotal: unknown;
  shippingTotal: unknown;
  grandTotal: unknown;
  preferredDeliveryDate: Date | null;
  customerNote: string | null;
  createdAt: Date;
  customer: { normalizedPhone: string; name: string | null };
  shippingAddress: {
    streetAddress: string;
    barangay: string | null;
    city: string;
    province: string;
    postalCode: string | null;
    landmark: string | null;
  } | null;
  items: { id: string; skuCodeSnapshot: string; quantity: number }[];
  riskFlags: { flagType: string }[];
};

const money = (value: unknown): string => (value === null || value === undefined ? '0' : String(value));

export function fingerprintInputForOrder(order: OrderWithVerificationFacts): VerificationFingerprintInput {
  return {
    customer: {
      normalizedPhone: order.customer.normalizedPhone,
      name: order.customer.name ?? '',
    },
    address: order.shippingAddress
      ? {
          streetAddress: order.shippingAddress.streetAddress,
          barangay: order.shippingAddress.barangay,
          city: order.shippingAddress.city,
          province: order.shippingAddress.province,
          postalCode: order.shippingAddress.postalCode,
          landmark: order.shippingAddress.landmark,
        }
      : null,
    items: order.items.map((i) => ({ skuCode: i.skuCodeSnapshot, quantity: i.quantity })),
    amount: {
      subtotal: money(order.subtotal),
      discountTotal: money(order.discountTotal),
      shippingTotal: money(order.shippingTotal),
      grandTotal: money(order.grandTotal),
    },
    delivery: {
      preferredDeliveryDate: order.preferredDeliveryDate
        ? order.preferredDeliveryDate.toISOString().slice(0, 10)
        : null,
      customerNote: order.customerNote,
    },
    riskFlags: order.riskFlags.map((f) => ({ flagType: f.flagType })),
    orderCreatedAt: order.createdAt.toISOString(),
  };
}

/**
 * Manual COD verification (stage 1A).
 *
 * The service owns three things:
 *   - who is checking the order and when they come back (the assignment)
 *   - what was checked (the items)
 *   - what happened, in order (the events)
 *
 * The checklist is a record, not a gate: the operator ticks what applies to
 * the order in front of them, and the confirmation does not wait for it.
 *
 * Nothing here rewrites order history: results are superseded by newer
 * events, and a changed order invalidates the affected results instead of
 * deleting them.
 */
@Injectable()
export class OrderVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assign the order to a handler with the checklist they have to work
   * through. Reassignment closes the previous assignment and opens a new one;
   * already verified items keep their result, their operator and their
   * history.
   */
  async assign(orderId: string, operatorId: string, input: AssignVerificationInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: VERIFICATION_ORDER_INCLUDE,
      });
      if (!order) throw new NotFoundException('Order not found');

      const now = new Date();
      const previous = await tx.orderVerificationAssignment.findFirst({
        where: { orderId, closedAt: null },
        orderBy: { assignedAt: 'desc' },
      });
      if (previous) {
        await tx.orderVerificationAssignment.update({
          where: { id: previous.id },
          data: { closedAt: now },
        });
      }
      const assignment = await tx.orderVerificationAssignment.create({
        data: {
          orderId,
          assigneeId: input.assigneeId ?? null,
          assignedById: operatorId,
          assignedAt: now,
          priority: input.priority,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          note: input.note ?? null,
        },
      });
      await tx.orderVerificationEvent.create({
        data: {
          orderId,
          assignmentId: assignment.id,
          type: previous ? 'REASSIGNED' : 'ASSIGNED',
          toStatus: 'PENDING',
          note: input.note ?? null,
          operatorId,
        },
      });

      const customByKey = new Map(input.customItems.map((c) => [c.key, c]));
      const desired = new Set([...input.itemKeys, ...customByKey.keys()]);
      // The person who checks a single question can differ from the owner of
      // the order.
      const perItemOwner = new Map(
        (input.itemAssignees ?? []).map((a) => [a.itemKey, a.assigneeId ?? null]),
      );
      // The handover note of a single question. It never replaces a result.
      const perItemNote = new Map(
        (input.itemNotes ?? []).map((n) => [n.itemKey, n.note ?? null]),
      );
      const existing = await tx.orderVerificationItem.findMany({ where: { orderId } });

      for (const item of existing) {
        if (desired.has(item.itemKey)) continue;
        if (item.status === 'PENDING') {
          // Never verified: the question simply is not part of this checklist.
          await tx.orderVerificationItem.delete({ where: { id: item.id } });
          continue;
        }
        // It carries a conclusion, so it stays on the record as "not
        // applicable" instead of being deleted behind the operator's back.
        await tx.orderVerificationItem.update({
          where: { id: item.id },
          data: {
            status: 'SKIPPED',
            skippedReason: '从核实清单中移除',
            assignmentId: null,
            operatorId,
            rev: { increment: 1 },
          },
        });
        await tx.orderVerificationEvent.create({
          data: {
            orderId,
            itemId: item.id,
            type: 'SKIPPED',
            fromStatus: item.status,
            toStatus: 'SKIPPED',
            note: '从核实清单中移除',
            operatorId,
          },
        });
      }

      for (const key of desired) {
        const definition = verificationItemByKey(key);
        const custom = customByKey.get(key);
        const title = definition?.title ?? custom?.title ?? key;
        // Nothing is mandatory: the operator ticks what applies to this
        // order, and the confirmation does not wait for the checklist. The
        // column stays (the database default is true) and is written false.
        const required = false;
        const category = (definition?.category ?? 'OTHER') as VerificationCategory;
        const current = existing.find((i) => i.itemKey === key);
        if (current) {
          // Keep the result and the history; only the owner of the checklist,
          // the person who checks this question and the handover note may
          // change.
          await tx.orderVerificationItem.update({
            where: { id: current.id },
            data: {
              assignmentId: assignment.id,
              titleSnapshot: title,
              required,
              category,
              assigneeId: perItemOwner.has(key)
                ? (perItemOwner.get(key) ?? null)
                : (current.assigneeId ?? null),
              note: perItemNote.has(key)
                ? perItemNote.get(key)
                : current.note,
            },
          });
          continue;
        }
        await tx.orderVerificationItem.create({
          data: {
            orderId,
            assignmentId: assignment.id,
            itemKey: key,
            category,
            titleSnapshot: title,
            required,
            assigneeId: perItemOwner.get(key) ?? null,
            note: perItemNote.get(key) ?? null,
            status: 'PENDING',
          },
        });
      }

      const items = await tx.orderVerificationItem.findMany({
        where: { orderId, assignmentId: assignment.id },
        orderBy: { createdAt: 'asc' },
      });
      return { assignment, items };
    });
  }

  /**
   * Record the outcome of one verification question. The result is stored
   * together with the fingerprint of the facts it was verified against, so a
   * later change to the order can invalidate it.
   */
  async setResult(
    orderId: string,
    itemKey: string,
    operatorId: string,
    input: SetVerificationResultInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: VERIFICATION_ORDER_INCLUDE,
      });
      if (!order) throw new NotFoundException('Order not found');
      const item = await tx.orderVerificationItem.findUnique({
        where: { orderId_itemKey: { orderId, itemKey } },
      });
      if (!item) throw new NotFoundException('Verification item not found');
      if (input.rev !== undefined && input.rev !== item.rev) {
        throw new ConflictException(
          '这条核实记录已被他人更新，请刷新后重试',
        );
      }
      if (input.status === 'DONE' && !(input.result || item.result)) {
        throw new BadRequestException('核实通过必须写明结果');
      }
      if (input.status === 'SKIPPED' && !(input.skippedReason || item.skippedReason)) {
        throw new BadRequestException('不适用必须写明原因');
      }

      const definition = verificationItemByKey(itemKey);
      const fingerprint = definition
        ? subjectFingerprint(definition.subject, fingerprintInputForOrder(order))
        : item.subjectFingerprint;

      const updated = await tx.orderVerificationItem.update({
        where: { id: item.id },
        data: {
          status: input.status,
          result: input.status === 'PENDING' ? null : (input.result ?? item.result),
          note: input.note ?? item.note,
          operatorId,
          completedAt:
            input.status === 'DONE' || input.status === 'SKIPPED'
              ? (item.completedAt ?? new Date())
              : null,
          nextFollowUpAt:
            input.nextFollowUpAt ?? (input.status === 'DONE' ? null : item.nextFollowUpAt),
          skippedReason:
            input.status === 'SKIPPED' ? (input.skippedReason ?? item.skippedReason) : null,
          subjectFingerprint: fingerprint,
          rev: { increment: 1 },
        },
      });

      await tx.orderVerificationEvent.create({
        data: {
          orderId,
          itemId: item.id,
          assignmentId: item.assignmentId,
          type: 'RESULT_SET',
          fromStatus: item.status,
          toStatus: input.status,
          result: input.result ?? null,
          note: input.note ?? null,
          operatorId,
        },
      });

      const open = await tx.orderVerificationAssignment.findFirst({
        where: { orderId, closedAt: null },
      });
      if (open) {
        await tx.orderVerificationAssignment.update({
          where: { id: open.id },
          data: {
            nextFollowUpAt:
              input.nextFollowUpAt ?? (input.status === 'DONE' ? null : open.nextFollowUpAt),
          },
        });
      }
      return updated;
    });
  }

  /**
   * Log a contact attempt. A dialled call that nobody answered is a fact of
   * its own: it never counts as a verification result.
   */
  async recordContact(
    orderId: string,
    itemKey: string | null,
    operatorId: string,
    input: ContactAttemptInput,
  ) {
    const item = itemKey
      ? await this.prisma.orderVerificationItem.findUnique({
          where: { orderId_itemKey: { orderId, itemKey } },
        })
      : null;
    if (itemKey && !item) throw new NotFoundException('Verification item not found');
    return this.prisma.orderVerificationEvent.create({
      data: {
        orderId,
        itemId: item?.id ?? null,
        assignmentId: item?.assignmentId ?? null,
        type: 'CONTACT_ATTEMPT',
        result: input.result,
        note: input.note ?? null,
        operatorId,
      },
    });
  }

  /**
   * Called after the order changed materially. Every verified item whose
   * subject changed is invalidated and has to be verified again.
   */
  async invalidateForChange(orderId: string, operatorId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: VERIFICATION_ORDER_INCLUDE,
      });
      if (!order) throw new NotFoundException('Order not found');
      const facts = fingerprintInputForOrder(order);
      const items = await tx.orderVerificationItem.findMany({
        where: { orderId, status: 'DONE' },
      });
      const invalidated: string[] = [];
      for (const item of items) {
        const definition = verificationItemByKey(item.itemKey);
        if (!definition) continue;
        const current = subjectFingerprint(definition.subject, facts);
        if (!item.subjectFingerprint || item.subjectFingerprint === current) continue;
        await tx.orderVerificationItem.update({
          where: { id: item.id },
          data: {
            status: 'INVALIDATED',
            invalidatedAt: new Date(),
            invalidatedReason: reason,
            rev: { increment: 1 },
          },
        });
        await tx.orderVerificationEvent.create({
          data: {
            orderId,
            itemId: item.id,
            assignmentId: item.assignmentId,
            type: 'INVALIDATED',
            fromStatus: 'DONE',
            toStatus: 'INVALIDATED',
            note: reason,
            operatorId,
          },
        });
        invalidated.push(item.itemKey);
      }
      return { invalidated };
    });
  }

  /** Everything the drawer needs: the assignment, the checklist and the log. */
  async listForOrder(orderId: string) {
    const assignment = await this.prisma.orderVerificationAssignment.findFirst({
      where: { orderId, closedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    const items = assignment
      ? await this.prisma.orderVerificationItem.findMany({
          where: { orderId, assignmentId: assignment.id },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const events = await this.prisma.orderVerificationEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { assignment, items, events };
  }

  /** The shipped checklists plus the ones the team wrote themselves. */
  async templates() {
    const custom = await this.prisma.verificationItemTemplate.findMany({
      where: { scope: 'CUSTOM' },
      orderBy: { createdAt: 'asc' },
    });
    return {
      system: VERIFICATION_TEMPLATES,
      library: VERIFICATION_LIBRARY,
      custom,
    };
  }

  async createTemplate(ownerId: string, input: CreateVerificationTemplateInput) {
    return this.prisma.verificationItemTemplate.create({
      data: {
        name: input.name,
        scope: 'CUSTOM',
        ownerId,
        items: input.items as unknown as object,
      },
    });
  }
}
