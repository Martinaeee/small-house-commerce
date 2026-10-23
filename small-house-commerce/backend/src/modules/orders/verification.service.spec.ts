import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrderVerificationService } from './verification.service.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const OPERATOR = '00000000-0000-4000-8000-0000000000b1';

type Row = Record<string, any>;

function orderFact(overrides: Row = {}): Row {
  return {
    id: ORDER_ID,
    subtotal: '1499.00',
    discountTotal: '0.00',
    shippingTotal: '0.00',
    grandTotal: '1499.00',
    preferredDeliveryDate: null,
    customerNote: null,
    createdAt: new Date('2026-10-21T14:22:00.000Z'),
    customer: { normalizedPhone: '+639171224466', name: 'Marisol Reyes' },
    shippingAddress: {
      streetAddress: '24-B Kamuning St.',
      barangay: 'Kamuning',
      city: 'Quezon City',
      province: 'Metro Manila',
      postalCode: '1103',
      landmark: null,
    },
    items: [{ id: 'line-1', skuCodeSnapshot: 'SKU-FD-140-WN', quantity: 1 }],
    riskFlags: [],
    ...overrides,
  };
}

function createHarness() {
  let seq = 0;
  const db = {
    assignments: [] as Row[],
    items: [] as Row[],
    events: [] as Row[],
    order: orderFact() as Row | null,
  };

  const applyUpdate = (row: Row, data: Row) => {
    const { rev, ...rest } = data;
    Object.assign(row, rest);
    if (rev && typeof rev === 'object' && typeof rev.increment === 'number') {
      row.rev = (row.rev ?? 1) + rev.increment;
    }
    return row;
  };

  const tx: Record<string, any> = {
    $queryRaw: vi.fn(async () => []),
    order: { findUnique: vi.fn(async () => db.order) },
    orderVerificationAssignment: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const rows = db.assignments.filter((a) => {
          if (where.orderId && a.orderId !== where.orderId) return false;
          // the column is NULL while the assignment is open
          if (where.closedAt === null && a.closedAt !== null && a.closedAt !== undefined) return false;
          return true;
        });
        rows.sort((a, b) => (a.assignedAt < b.assignedAt ? 1 : -1));
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `as-${++seq}`, rev: 1, createdAt: new Date(), closedAt: null, ...data };
        db.assignments.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) =>
        applyUpdate(db.assignments.find((a) => a.id === where.id)!, data),
      ),
    },
    orderVerificationItem: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.items.filter((i) => {
          if (where.orderId && i.orderId !== where.orderId) return false;
          if (where.assignmentId && i.assignmentId !== where.assignmentId) return false;
          if (where.status && i.status !== where.status) return false;
          return true;
        }),
      ),
      findUnique: vi.fn(async ({ where }: { where: { orderId_itemKey: Row } }) => {
        const key = where.orderId_itemKey;
        return (
          db.items.find((i) => i.orderId === key.orderId && i.itemKey === key.itemKey) ?? null
        );
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `it-${++seq}`,
          rev: 1,
          status: 'PENDING',
          result: null,
          note: null,
          operatorId: null,
          completedAt: null,
          nextFollowUpAt: null,
          skippedReason: null,
          subjectFingerprint: null,
          invalidatedAt: null,
          invalidatedReason: null,
          createdAt: new Date(),
          ...data,
        };
        db.items.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) =>
        applyUpdate(db.items.find((i) => i.id === where.id)!, data),
      ),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const index = db.items.findIndex((i) => i.id === where.id);
        if (index >= 0) db.items.splice(index, 1);
        return {};
      }),
    },
    orderVerificationEvent: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `ev-${++seq}`, createdAt: new Date(), ...data };
        db.events.push(row);
        return row;
      }),
    },
  };

  const prisma = {
    ...tx,
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const service = new OrderVerificationService(prisma as never);
  return { service, db, prisma, tx };
}

const baseInput = {
  assigneeId: OPERATOR,
  priority: 'NORMAL' as const,
  itemKeys: ['phone_valid', 'intent', 'addr_area'],
  customItems: [],
  itemAssignees: [],
  itemNotes: [],
  note: null,
  nextFollowUpAt: null,
};

describe('OrderVerificationService', () => {
  describe('assign', () => {
    it('opens an assignment with the checklist and records the assignment event', async () => {
      const { service, db } = createHarness();
      const { assignment, items } = await service.assign(ORDER_ID, OPERATOR, baseInput);

      expect(assignment.assigneeId).toBe(OPERATOR);
      expect(assignment.closedAt).toBeNull();
      expect(items).toHaveLength(3);
      expect(items.map((i) => i.itemKey).sort()).toEqual(['addr_area', 'intent', 'phone_valid']);
      expect(items.every((i) => i.status === 'PENDING')).toBe(true);
      expect(db.events[0]).toMatchObject({ type: 'ASSIGNED', operatorId: OPERATOR });
    });

    it('keeps a verified result when the order is reassigned', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      await service.setResult(ORDER_ID, 'intent', OPERATOR, { status: 'DONE', result: '客户明确确认购买' });

      const second = await service.assign(ORDER_ID, OPERATOR, {
        ...baseInput,
        assigneeId: '00000000-0000-4000-8000-0000000000c1',
        itemKeys: ['phone_valid', 'intent', 'addr_area'],
      });

      expect(db.assignments).toHaveLength(2);
      expect(db.assignments[0].closedAt).not.toBeNull();
      const intent = second.items.find((i) => i.itemKey === 'intent');
      expect(intent?.status).toBe('DONE');
      expect(intent?.result).toBe('客户明确确认购买');
      expect(intent?.assignmentId).toBe(second.assignment.id);
      expect(db.events.some((e) => e.type === 'REASSIGNED')).toBe(true);
    });

    it('removes a question that was never verified', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      const { items } = await service.assign(ORDER_ID, OPERATOR, {
        ...baseInput,
        itemKeys: ['phone_valid', 'intent'],
      });
      expect(items.map((i) => i.itemKey).sort()).toEqual(['intent', 'phone_valid']);
      expect(db.items.some((i) => i.itemKey === 'addr_area')).toBe(false);
    });

    it('keeps a question that carries a conclusion as "not applicable" instead of deleting it', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      await service.setResult(ORDER_ID, 'intent', OPERATOR, { status: 'DONE', result: '客户明确确认购买' });

      const { items } = await service.assign(ORDER_ID, OPERATOR, {
        ...baseInput,
        itemKeys: ['phone_valid', 'addr_area'],
      });

      const dropped = db.items.find((i) => i.itemKey === 'intent')!;
      expect(dropped.status).toBe('SKIPPED');
      expect(dropped.result).toBe('客户明确确认购买');
      expect(dropped.skippedReason).toBe('从核实清单中移除');
      expect(items.map((i) => i.itemKey).sort()).toEqual(['addr_area', 'phone_valid']);
    });

    it('keeps the person who checks a single question', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, {
        ...baseInput,
        itemKeys: ['intent', 'phone_valid'],
        itemAssignees: [{ itemKey: 'intent', assigneeId: '00000000-0000-4000-8000-0000000000c1' }],
      });
      const intent = db.items.find((i) => i.itemKey === 'intent');
      expect(intent?.assigneeId).toBe('00000000-0000-4000-8000-0000000000c1');

      // a reassignment keeps the per-question owner
      await service.assign(ORDER_ID, OPERATOR, {
        ...baseInput,
        itemKeys: ['intent', 'phone_valid'],
      });
      const kept = db.items.find((i) => i.itemKey === 'intent');
      expect(kept?.assigneeId).toBe('00000000-0000-4000-8000-0000000000c1');
    });

    it('adds a custom question with its own key', async () => {
      const { service } = createHarness();
      const { items } = await service.assign(ORDER_ID, OPERATOR, {
        ...baseInput,
        itemKeys: [],
        customItems: [{ key: 'custom:abc', title: '客户要求周末送达', required: false }],
      });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ itemKey: 'custom:abc', titleSnapshot: '客户要求周末送达', required: false });
    });

    it('refuses an unknown order', async () => {
      const { service, db } = createHarness();
      db.order = null;
      await expect(service.assign('missing', OPERATOR, baseInput)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setResult', () => {
    it('stores the result, the operator and the fingerprint of the facts', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      const updated = await service.setResult(ORDER_ID, 'intent', OPERATOR, {
        status: 'DONE',
        result: '客户明确确认购买',
      });

      expect(updated.status).toBe('DONE');
      expect(updated.operatorId).toBe(OPERATOR);
      expect(updated.completedAt).toBeInstanceOf(Date);
      expect(typeof updated.subjectFingerprint).toBe('string');
      expect(db.events.some((e) => e.type === 'RESULT_SET' && e.toStatus === 'DONE')).toBe(true);
    });

    it('refuses a pass without a result', async () => {
      const { service } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      await expect(
        service.setResult(ORDER_ID, 'intent', OPERATOR, { status: 'DONE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses "not applicable" without a reason', async () => {
      const { service } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      await expect(
        service.setResult(ORDER_ID, 'intent', OPERATOR, { status: 'SKIPPED' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a stale write instead of overwriting the other operator', async () => {
      const { service } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      const item = await service.setResult(ORDER_ID, 'intent', OPERATOR, { status: 'DONE', result: 'ok' });
      await expect(
        service.setResult(ORDER_ID, 'intent', OPERATOR, { status: 'DONE', result: 'other', rev: item.rev - 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('records a follow-up time on a problem and clears it on a pass', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      await service.setResult(ORDER_ID, 'phone_valid', OPERATOR, {
        status: 'PROBLEM',
        result: '未接通',
        nextFollowUpAt: new Date('2026-10-22T09:00:00.000Z'),
      });
      const problem = db.items.find((i) => i.itemKey === 'phone_valid')!;
      expect(problem.nextFollowUpAt).toBeInstanceOf(Date);

      await service.setResult(ORDER_ID, 'phone_valid', OPERATOR, { status: 'DONE', result: '接通' });
      const done = db.items.find((i) => i.itemKey === 'phone_valid')!;
      expect(done.nextFollowUpAt).toBeNull();
    });
  });

  describe('recordContact', () => {
    it('logs the attempt without changing the verification result', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      const event = await service.recordContact(ORDER_ID, 'phone_valid', OPERATOR, {
        result: '无人接听',
        note: '10-21 15:40 拨打',
      });
      expect(event).toMatchObject({ type: 'CONTACT_ATTEMPT', result: '无人接听' });
      const item = db.items.find((i) => i.itemKey === 'phone_valid')!;
      expect(item.status).toBe('PENDING');
      expect(item.result).toBeNull();
    });
  });

  describe('invalidateForChange', () => {
    it('invalidates the results whose facts changed and keeps the others', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, {
        ...baseInput,
        itemKeys: ['intent', 'addr_area'],
      });
      await service.setResult(ORDER_ID, 'intent', OPERATOR, { status: 'DONE', result: '客户确认购买' });
      await service.setResult(ORDER_ID, 'addr_area', OPERATOR, { status: 'DONE', result: '地址已核对' });

      // the address changes, the customer does not
      db.order = orderFact({
        shippingAddress: {
          streetAddress: '24-B Kamuning St.',
          barangay: 'Bagong Silang',
          city: 'Quezon City',
          province: 'Metro Manila',
          postalCode: '1103',
          landmark: null,
        },
      });

      const { invalidated } = await service.invalidateForChange(ORDER_ID, OPERATOR, '收货地址已修改');
      expect(invalidated).toEqual(['addr_area']);
      const address = db.items.find((i) => i.itemKey === 'addr_area')!;
      expect(address.status).toBe('INVALIDATED');
      expect(address.invalidatedReason).toBe('收货地址已修改');
      const intent = db.items.find((i) => i.itemKey === 'intent')!;
      expect(intent.status).toBe('DONE');
      expect(db.events.some((e) => e.type === 'INVALIDATED')).toBe(true);
    });
  });

  describe('the result of a question', () => {
    it('keeps "not applicable" with its reason', async () => {
      const { service, db } = createHarness();
      await service.assign(ORDER_ID, OPERATOR, baseInput);
      await service.setResult(ORDER_ID, 'addr_area', OPERATOR, {
        status: 'SKIPPED',
        skippedReason: '客户提供了地址快照，线下核对',
      });
      const items = db.items ?? [];
      const skipped = items.find((i) => i.itemKey === 'addr_area');
      expect(skipped?.status).toBe('SKIPPED');
      expect(skipped?.skippedReason).toContain('线下核对');
    });

    it('becomes invalid again when the order changes', async () => {
      const { service, db } = createHarness();
      // the quantity question depends on the order items
      await service.assign(ORDER_ID, OPERATOR, { ...baseInput, itemKeys: ['intent', 'qty'] });
      for (const key of ['intent', 'qty']) {
        await service.setResult(ORDER_ID, key, OPERATOR, { status: 'DONE', result: '已核实' });
      }
      db.order = orderFact({
        items: [{ id: 'line-1', skuCodeSnapshot: 'SKU-FD-140-WN', quantity: 2 }],
      });
      const { invalidated } = await service.invalidateForChange(ORDER_ID, OPERATOR, '商品数量已修改');
      expect(invalidated).toEqual(['qty']);
    });
  });
});
