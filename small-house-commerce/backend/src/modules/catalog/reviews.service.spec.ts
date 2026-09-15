import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { batchReviewsSchema, createAdminReviewSchema } from './dto/review.dto.js';
import { ReviewsService } from './reviews.service.js';

function createPrismaMock() {
  return {
    product: { findUnique: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'p1' })) },
    productReview: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'r1', ...args.data })),
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
