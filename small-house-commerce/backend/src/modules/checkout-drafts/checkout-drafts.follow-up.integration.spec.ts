import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CheckoutDraftsService } from './checkout-drafts.service.js';

const database = process.env.DRAFT_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/draft_followup_test') {
    throw new Error('Draft follow-up tests require the dedicated local draft_followup_test database.');
  }
}

describe.skipIf(!database)('checkout draft follow-up with real PostgreSQL', () => {
  let prisma: PrismaService;
  let service: CheckoutDraftsService;
  let operatorId: string;
  let assigneeId: string;
  let draftId: string;

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    const suffix = randomUUID();
    const operator = await prisma.user.create({ data: {
      name: 'Draft follow-up operator', email: `draft-operator-${suffix}@example.test`, passwordHash: 'not-a-login-hash',
    } });
    const assignee = await prisma.user.create({ data: {
      name: 'Draft follow-up assignee', email: `draft-assignee-${suffix}@example.test`, passwordHash: 'not-a-login-hash',
    } });
    operatorId = operator.id;
    assigneeId = assignee.id;
    const draft = await prisma.checkoutDraft.create({ data: {
      tokenHash: suffix, tokenIssuedAt: new Date(), hasUserInput: true,
      contactName: 'Ana', contactPhone: '0917', expiresAt: new Date(Date.now() + 7 * 864e5),
    } });
    draftId = draft.id;
    service = new CheckoutDraftsService(prisma);
  });

  afterAll(async () => {
    if (!prisma) return;
    if (draftId) await prisma.checkoutDraft.delete({ where: { id: draftId } }).catch(() => {});
    if (assigneeId) await prisma.user.delete({ where: { id: assigneeId } }).catch(() => {});
    if (operatorId) await prisma.user.delete({ where: { id: operatorId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('stores the result, resolves the assignee and appends the timeline entry', async () => {
    const saved = await service.followUp(draftId, {
      status: 'TO_CONTACT', assigneeId, note: 'Call before noon',
    }, operatorId);

    expect(saved).toMatchObject({ followUpStatus: 'TO_CONTACT', assignee: { id: assigneeId, name: 'Draft follow-up assignee' }, followUpNote: 'Call before noon' });

    const detail = await service.detail(draftId);
    expect(detail.followUpEvents).toHaveLength(1);
    expect(detail.followUpEvents[0]).toMatchObject({ fromStatus: null, toStatus: 'TO_CONTACT', note: 'Call before noon', operatorName: 'Draft follow-up operator' });

    const second = await service.followUp(draftId, { status: 'WANTS_TO_BUY', nextFollowUpAt: null }, operatorId);
    expect(second.followUpStatus).toBe('WANTS_TO_BUY');
    expect((await service.detail(draftId)).followUpEvents).toHaveLength(2);
  });

  it('lists overdue unfinished follow-ups and excludes the converted draft', async () => {
    const overdue = await prisma.checkoutDraft.create({ data: {
      tokenHash: randomUUID(), tokenIssuedAt: new Date(), hasUserInput: true,
      contactName: 'Overdue', contactPhone: '0918', expiresAt: new Date(Date.now() + 7 * 864e5),
      followUpStatus: 'NO_ANSWER', nextFollowUpAt: new Date(Date.now() - 3600_000),
    } });
    const list = await service.list({ dueOnly: true, page: 1, pageSize: 50 });
    expect(list.items.map((row) => row.id)).toContain(overdue.id);
    await prisma.checkoutDraft.delete({ where: { id: overdue.id } });

    await prisma.checkoutDraft.update({ where: { id: draftId }, data: { status: 'CONVERTED', orderId: null } });
    await expect(service.followUp(draftId, { status: 'DECLINED' }, operatorId)).rejects.toMatchObject({ status: 409 });
  });
});
