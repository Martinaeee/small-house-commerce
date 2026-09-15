import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  batchReviewsSchema,
  createAdminReviewSchema,
  updateAdminReviewSchema,
} from './dto/review.dto.js';
import { serializeReview } from './review-utils.js';
import { ReviewsService } from './reviews.service.js';

function createPrismaMock() {
  return {
    product: { findUnique: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'p1' })) },
    productReview: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'r1', ...args.data })),
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'r1' })),
      findUnique: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'r1' })),
    },
    reviewHelpfulVote: {
      upsert: vi.fn(async (_args: unknown) => ({ id: 'v1' })),
      aggregate: vi.fn(async () => ({ _count: { _all: 1 } })),
    },
    reviewReport: {
      upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({ id: 'f1', ...args.create })),
      findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

const validRow = () => ({
  authorName: 'Maria',
  location: 'Cebu',
  rating: 5,
  title: 'Great',
  comment: 'Maganda ang quality, sulit sa presyo.',
  photos: [],
  isVisible: true,
});

describe('ReviewsService.adminBatchCreate', () => {
  it('inserts every valid row in one transaction as ADMIN and returns created count', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);
    const result = await service.adminBatchCreate('p1', [validRow(), { ...validRow(), authorName: 'Jose' }]);
    expect(result).toEqual({ created: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.productReview.create).toHaveBeenCalledTimes(2);
    for (const call of prisma.productReview.create.mock.calls) {
      expect(call[0].data).toMatchObject({ productId: 'p1', source: 'ADMIN', rating: 5 });
    }
  });

  it('rejects the whole batch with row-scoped errors and inserts nothing', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);
    const bad = [
      validRow(),
      { authorName: '', location: 'Cebu', rating: 9, title: '', comment: '', photos: [] },
    ];
    await expect(service.adminBatchCreate('p1', bad)).rejects.toBeInstanceOf(BadRequestException);
    try {
      await service.adminBatchCreate('p1', bad);
      throw new Error('should have thrown');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        errors: Array<{ row: number; field: string; message: string }>;
      };
      expect(body.errors.length).toBeGreaterThanOrEqual(3);
      expect(body.errors.every((e) => e.row === 2)).toBe(true);
      expect(body.errors.map((e) => e.field)).toEqual(
        expect.arrayContaining(['authorName', 'rating', 'comment']),
      );
    }
    expect(prisma.productReview.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404s on unknown product and inserts nothing', async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValueOnce(null);
    const service = new ReviewsService(prisma as never);
    await expect(service.adminBatchCreate('missing', [validRow()])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.productReview.create).not.toHaveBeenCalled();
  });

  it('batch DTO only accepts 1..100 raw items', () => {
    expect(batchReviewsSchema.safeParse({ items: [] }).success).toBe(false);
    expect(batchReviewsSchema.safeParse({ items: Array(101).fill(validRow()) }).success).toBe(false);
    expect(batchReviewsSchema.safeParse({ items: [validRow()] }).success).toBe(true);
  });

  it('persists an admin-supplied backdated createdAt as a Date', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);
    const when = '2026-08-01T04:00:00.000Z';

    await service.adminBatchCreate('p1', [{ ...validRow(), createdAt: when }]);

    expect(prisma.productReview.create).toHaveBeenCalledTimes(1);
    expect(prisma.productReview.create.mock.calls[0][0].data).toMatchObject({
      createdAt: new Date(when),
    });
  });

  it('single create with omitted createdAt leaves the DB default', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);

    await service.adminCreate('p1', {
      authorName: 'Maria',
      rating: 5,
      comment: 'ok',
      photos: [],
      isVisible: true,
    });

    expect(prisma.productReview.create.mock.calls[0][0].data.createdAt).toBeUndefined();
  });
});

describe('createAdminReviewSchema.createdAt', () => {
  it('accepts a past ISO timestamp and rejects future/garbage', () => {
    expect(
      createAdminReviewSchema.safeParse({ ...validRow(), createdAt: '2026-08-01T04:00:00.000Z' })
        .success,
    ).toBe(true);
    expect(createAdminReviewSchema.safeParse({ ...validRow() }).success).toBe(true);

    const future = new Date(Date.now() + 24 * 3600_000).toISOString();
    const futureResult = createAdminReviewSchema.safeParse({ ...validRow(), createdAt: future });
    expect(futureResult.success).toBe(false);
    if (!futureResult.success) {
      expect(futureResult.error.issues[0].message).toMatch(/不能晚于/);
    }

    const bad = createAdminReviewSchema.safeParse({
      ...validRow(),
      createdAt: 'September 1st',
    });
    expect(bad.success).toBe(false);
  });
});

describe('createAdminReviewSchema.variant', () => {
  it('accepts absent/short variant and rejects oversized text', () => {
    expect(createAdminReviewSchema.safeParse(validRow()).success).toBe(true);
    expect(
      createAdminReviewSchema.safeParse({
        ...validRow(),
        variant: 'Color: Walnut Brown | Size: S',
      }).success,
    ).toBe(true);
    const over = createAdminReviewSchema.safeParse({
      ...validRow(),
      variant: 'x'.repeat(301),
    });
    expect(over.success).toBe(false);
  });

  it('update schema allows null to clear the variant', () => {
    expect(updateAdminReviewSchema.safeParse({ variant: null }).success).toBe(true);
    expect(updateAdminReviewSchema.safeParse({}).success).toBe(true);
  });

  it('persists the variant text on batch rows', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);
    await service.adminBatchCreate('p1', [
      { ...validRow(), variant: 'Color: Natural Wood' },
    ]);
    expect(prisma.productReview.create.mock.calls[0][0].data).toMatchObject({
      variant: 'Color: Natural Wood',
    });
  });
});

describe('ReviewsService review feedback', () => {
  it('records one helpful vote per visitor hash and returns the total', async () => {
    const prisma = createPrismaMock();
    prisma.reviewHelpfulVote.aggregate.mockResolvedValueOnce({ _count: { _all: 3 } });
    const service = new ReviewsService(prisma as never);

    const result = await service.addHelpfulVote('r1', 'hash-a');

    expect(result).toEqual({ helpfulCount: 3, voted: true });
    expect(prisma.reviewHelpfulVote.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reviewId_visitorHash: { reviewId: 'r1', visitorHash: 'hash-a' } },
      }),
    );
  });

  it('404s a helpful vote on a hidden or missing review', async () => {
    const prisma = createPrismaMock();
    prisma.productReview.findFirst.mockResolvedValueOnce(null);
    const service = new ReviewsService(prisma as never);
    await expect(service.addHelpfulVote('gone', 'h')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.reviewHelpfulVote.upsert).not.toHaveBeenCalled();
  });

  it('stores a report reason and turns empty input into null', async () => {
    const prisma = createPrismaMock();
    const service = new ReviewsService(prisma as never);

    await service.addReport('r1', 'spam content', 'hash-a');
    await service.addReport('r1', null, 'hash-b');

    expect(prisma.reviewReport.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.reviewReport.upsert.mock.calls[0][0].create).toMatchObject({
      reason: 'spam content',
    });
    expect(prisma.reviewReport.upsert.mock.calls[1][0].create).toMatchObject({
      reason: null,
    });
  });

  it('lists and clears reports for admin', async () => {
    const prisma = createPrismaMock();
    prisma.reviewReport.findMany.mockResolvedValueOnce([{ id: 'f1' }]);
    prisma.reviewReport.deleteMany.mockResolvedValueOnce({ count: 1 });
    const service = new ReviewsService(prisma as never);

    const list = await service.adminListReports('r1');
    expect(list).toEqual([{ id: 'f1' }]);
    expect(await service.adminClearReports('r1')).toEqual({ cleared: 1 });
  });
});

describe('serializeReview feedback fields', () => {
  const baseRow = {
    id: 'r1',
    authorName: 'Sally',
    location: 'Manila',
    rating: 5,
    title: 'Looks good',
    comment: 'sturdy',
    photos: [],
    variant: null,
    verifiedOrderItemId: null,
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
  };

  it('defaults helpfulCount to 0 without an include and never verifies ADMIN rows', () => {
    const shape = serializeReview(baseRow);
    expect(shape).toMatchObject({
      variant: null,
      helpfulCount: 0,
      verifiedPurchase: false,
    });
  });

  it('exposes variant/count and the verified badge only with a linked order', () => {
    const withVotes = serializeReview({
      ...baseRow,
      variant: 'Color: Walnut Brown | Size: S',
      _count: { helpfulVotes: 12 },
    });
    expect(withVotes.variant).toBe('Color: Walnut Brown | Size: S');
    expect(withVotes.helpfulCount).toBe(12);
    expect(withVotes.verifiedPurchase).toBe(false);

    const linked = serializeReview({ ...baseRow, verifiedOrderItemId: '01a0...' });
    expect(linked.verifiedPurchase).toBe(true);
  });
});
