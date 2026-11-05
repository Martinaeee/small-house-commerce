import { describe, expect, it, vi } from 'vitest';
import { CheckoutDraftsService } from './checkout-drafts.service.js';

function draftRow(over: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    status: 'OPEN',
    hasUserInput: true,
    contactName: 'Ana',
    contactPhone: '0917',
    snapshot: {},
    productSnapshot: [],
    orderId: null,
    order: null,
    followUpStatus: null,
    followUpNote: null,
    nextFollowUpAt: null,
    lastContactedAt: null,
    assigneeId: null,
    assignee: null,
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-02'),
    expiresAt: new Date('2026-12-01'),
    followUpEvents: [],
    ...over,
  };
}

function setup(row: Record<string, unknown> = draftRow()) {
  const updates: unknown[] = [];
  const events: unknown[] = [];
  const prisma = {
    checkoutDraft: {
      findMany: vi.fn(async () => [row]),
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        Object.assign(row, data);
        return row;
      }),
    },
    checkoutDraftFollowUpEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(prisma)),
  };
  return { service: new CheckoutDraftsService(prisma as never), prisma, row, updates, events };
}

const NOW = new Date('2026-11-05T10:00:00Z');

describe('checkout draft customer-service follow-up', () => {
  it('saves the status, assignee, next follow-up and note with a timeline entry', async () => {
    const h = setup();
    await h.service.followUp('draft-1', {
      status: 'TO_CONTACT',
      assigneeId: 'user-2',
      nextFollowUpAt: '2026-11-06T02:00:00.000Z',
      note: 'Call after lunch',
    }, 'user-9', NOW);

    expect(h.updates).toEqual([{
      followUpStatus: 'TO_CONTACT',
      assigneeId: 'user-2',
      nextFollowUpAt: new Date('2026-11-06T02:00:00.000Z'),
      lastContactedAt: NOW,
      followUpNote: 'Call after lunch',
    }]);
    expect(h.events[0]).toMatchObject({ draftId: 'draft-1', operatorId: 'user-9', fromStatus: null, toStatus: 'TO_CONTACT', note: 'Call after lunch', createdAt: NOW });
  });

  it('keeps an existing assignee and note when the operator only records a result', async () => {
    const h = setup(draftRow({ followUpStatus: 'TO_CONTACT', assigneeId: 'user-2', followUpNote: 'First attempt' }));
    await h.service.followUp('draft-1', { status: 'NO_ANSWER' }, 'user-9', NOW);
    expect(h.updates).toEqual([{ followUpStatus: 'NO_ANSWER', lastContactedAt: NOW }]);
    expect(h.events[0]).toMatchObject({ fromStatus: 'TO_CONTACT', toStatus: 'NO_ANSWER', note: null });
  });

  it('rejects a draft that was already converted into an order', async () => {
    const h = setup(draftRow({ status: 'CONVERTED', orderId: 'order-1' }));
    await expect(h.service.followUp('draft-1', { status: 'TO_CONTACT' }, 'user-9', NOW)).rejects.toMatchObject({ status: 409 });
    expect(h.updates).toEqual([]);
  });

  it('hides expired and missing drafts', async () => {
    const h = setup(draftRow({ expiresAt: new Date('2026-11-01T00:00:00Z') }));
    await expect(h.service.followUp('draft-1', { status: 'TO_CONTACT' }, 'user-9', NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe('checkout draft follow-up filters', () => {
  it('filters unfinished drafts that nobody owns yet', async () => {
    const { service, prisma } = setup();
    await service.list({ followUpStatus: 'UNFOLLOWED', page: 1, pageSize: 20 });
    expect(prisma.checkoutDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ followUpStatus: null, status: { in: ['OPEN', 'CONVERTED'] } }),
    }));
  });

  it('filters by one result, one assignee and an overdue follow-up date', async () => {
    const { service, prisma } = setup();
    await service.list({ followUpStatus: 'NO_ANSWER', assigneeId: 'user-2', dueOnly: true, page: 1, pageSize: 20 });
    expect(prisma.checkoutDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        followUpStatus: 'NO_ANSWER',
        assigneeId: 'user-2',
        nextFollowUpAt: { lte: expect.any(Date) },
      }),
    }));
  });

  it('keeps only open follow-up results when asking for overdue work alone', async () => {
    const { service, prisma } = setup();
    await service.list({ dueOnly: true, page: 1, pageSize: 20 });
    expect(prisma.checkoutDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        followUpStatus: { in: ['TO_CONTACT', 'NO_ANSWER', 'FOLLOW_UP_LATER'] },
        nextFollowUpAt: { lte: expect.any(Date) },
      }),
    }));
  });
});
