import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { QuestionsService } from './questions.service.js';
import { revalidateCache } from '../../common/revalidation.js';
import { MAX_FAQ_ITEMS } from './faq/faq-content.js';

function faqRace() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: { modelName: 'ProductFaq', target: ['productId'] },
  });
}

vi.mock('../../common/revalidation.js', () => ({
  CACHE_TAGS: { STOREFRONT: 'storefront' },
  revalidateCache: vi.fn(async () => undefined),
}));

const QUESTION_ID = '11111111-1111-4111-a111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-a222-222222222222';
const PENDING_QUESTION = {
  id: QUESTION_ID,
  productId: PRODUCT_ID,
  question: 'Is the desk solid wood?',
  status: 'PENDING',
};

const storedItem = {
  id: '33333333-3333-4333-a333-333333333333',
  title: 'Do you deliver to Cebu?',
  answer: [{ kind: 'paragraph', text: 'Yes, nationwide.' }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

function harness(options: {
  product?: { id: string } | null;
  question?: typeof PENDING_QUESTION | null;
  faq?: { mode: string; items: unknown[]; version: number } | null;
  versionConflict?: boolean;
  createRace?: boolean;
} = {}) {
  const product = options.product === undefined ? { id: PRODUCT_ID } : options.product;
  const question = options.question === undefined ? PENDING_QUESTION : options.question;
  const faq = options.faq === undefined
    ? { mode: 'SHARED', items: [storedItem], version: 3 }
    : options.faq;

  const tx = {
    productQuestion: {
      findUnique: vi.fn(async () => question),
      updateMany: vi.fn(async () => ({ count: question?.status === 'PENDING' ? 1 : 0 })),
    },
    productFaq: {
      findUnique: vi.fn(async () => faq),
      updateMany: vi.fn(async () => ({ count: options.versionConflict ? 0 : 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (options.createRace) throw faqRace();
        return data;
      }),
    },
  };

  const prisma = {
    product: { findFirst: vi.fn(async () => product) },
    productQuestion: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: QUESTION_ID, ...data })),
      findMany: vi.fn(async () => [] as unknown[]),
      count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };

  const service = new QuestionsService(
    prisma as never,
    () => new Date('2026-10-19T12:00:00.000Z'),
  );
  return { service, prisma, tx };
}

beforeEach(() => vi.mocked(revalidateCache).mockClear());

describe('QuestionsService.create', () => {
  it('stores an anonymous submission as pending for an active product', async () => {
    const { service, prisma } = harness();

    await expect(
      service.create('foldable-desk', { question: '  Is the desk solid wood?  ' }),
    ).resolves.toEqual({ ok: true });

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { slug: 'foldable-desk', status: 'ACTIVE' },
      select: { id: true },
    });
    expect(prisma.productQuestion.create).toHaveBeenCalledWith({
      data: {
        productId: PRODUCT_ID,
        question: 'Is the desk solid wood?',
        askerName: null,
        askerEmail: null,
      },
    });
  });

  it('keeps the optional name and email on the inbox row only', async () => {
    const { service, prisma } = harness();

    await service.create('foldable-desk', {
      question: 'Can it ship to Mindanao?',
      name: 'Ana',
      email: 'ana@example.com',
    });

    expect(prisma.productQuestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ askerName: 'Ana', askerEmail: 'ana@example.com' }),
    });
  });

  it('refuses unknown or unpublished products', async () => {
    const { service } = harness({ product: null });

    await expect(
      service.create('missing', { question: 'Any question?' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('QuestionsService.adminList', () => {
  it('filters by status and paginates newest first', async () => {
    const { service, prisma } = harness();

    await service.adminList({ status: 'PENDING', page: 2, pageSize: 10 });

    expect(prisma.productQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      }),
    );
    expect(prisma.productQuestion.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
  });
});

describe('QuestionsService.convert', () => {
  it('answers a pending question into a product FAQ entry and extends shared mode', async () => {
    const { service, tx } = harness();

    const result = await service.convert(QUESTION_ID, { answer: 'Yes — solid rubberwood.' });

    expect(tx.productFaq.findUnique).toHaveBeenCalledWith({
      where: { productId: PRODUCT_ID },
      select: { mode: true, items: true, version: true },
    });
    const update = tx.productFaq.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: { mode: string; items: Array<Record<string, unknown>>; version: number };
    };
    expect(update.where).toEqual({ productId: PRODUCT_ID, version: 3 });
    expect(update.data.mode).toBe('EXTEND');
    expect(update.data.version).toBe(4);
    const added = update.data.items[update.data.items.length - 1];
    expect(added).toMatchObject({
      title: 'Is the desk solid wood?',
      answer: [{ kind: 'paragraph', text: 'Yes — solid rubberwood.' }],
      enabled: true,
      defaultOpen: false,
      position: 1,
    });
    expect(tx.productQuestion.updateMany).toHaveBeenCalledWith({
      where: { id: QUESTION_ID, status: 'PENDING' },
      data: { status: 'CONVERTED' },
    });
    expect(result).toEqual({ ok: true });
    expect(revalidateCache).toHaveBeenCalledWith(['storefront']);
  });

  it('creates the product FAQ row in EXTEND mode when the product had none', async () => {
    const { service, tx } = harness({ faq: null });

    await service.convert(QUESTION_ID, { answer: 'Yes.' });

    const create = tx.productFaq.create.mock.calls[0][0] as {
      data: { mode: string; items: Array<Record<string, unknown>>; version: number };
    };
    expect(create.data.mode).toBe('EXTEND');
    expect(create.data.version).toBe(1);
    expect(create.data.items).toHaveLength(1);
    expect(create.data.items[0]).toMatchObject({ title: 'Is the desk solid wood?', enabled: true });
  });

  it('only converts a question that is still pending', async () => {
    const { service } = harness({
      question: { ...PENDING_QUESTION, status: 'CONVERTED' },
    });

    await expect(service.convert(QUESTION_ID, { answer: 'Yes.' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses when the product FAQ is already full', async () => {
    const fullItems = Array.from({ length: MAX_FAQ_ITEMS }, (_, index) => ({
      ...storedItem,
      id: `33333333-3333-4333-a333-${String(index).padStart(12, '0')}`,
      position: index,
    }));
    const { service } = harness({ faq: { mode: 'CUSTOM', items: fullItems, version: 1 } });

    await expect(service.convert(QUESTION_ID, { answer: 'Yes.' })).rejects.toMatchObject({
      response: { code: 'FAQ_FULL' },
    });
  });

  it('reports a concurrent FAQ edit instead of overwriting it', async () => {
    const { service } = harness({ versionConflict: true });

    await expect(service.convert(QUESTION_ID, { answer: 'Yes.' })).rejects.toMatchObject({
      response: { code: 'FAQ_VERSION_MISMATCH' },
    });
  });

  it('maps a first-FAQ create race to a reloadable conflict', async () => {
    const { service } = harness({ faq: null, createRace: true });

    await expect(service.convert(QUESTION_ID, { answer: 'Yes.' })).rejects.toMatchObject({
      response: { code: 'FAQ_VERSION_MISMATCH' },
    });
  });
});

describe('QuestionsService.dismiss', () => {
  it('marks a pending question dismissed without touching the FAQ', async () => {
    const { service, tx } = harness();

    await expect(service.dismiss(QUESTION_ID)).resolves.toEqual({ ok: true });
    expect(tx.productQuestion.updateMany).toHaveBeenCalledWith({
      where: { id: QUESTION_ID, status: 'PENDING' },
      data: { status: 'DISMISSED' },
    });
    expect(tx.productFaq.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to dismiss a question that was already handled', async () => {
    const { service } = harness({
      question: { ...PENDING_QUESTION, status: 'DISMISSED' },
    });

    await expect(service.dismiss(QUESTION_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});
