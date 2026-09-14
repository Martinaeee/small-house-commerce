// src/modules/catalog/reviews.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  BatchReviewsInput,
  CreateAdminReviewInput,
  UpdateAdminReviewInput,
} from './dto/review.dto.js';
import { createAdminReviewSchema } from './dto/review.dto.js';
import {
  serializeReview,
  type RatingSummary,
  type StorefrontReviewShape,
} from './review-utils.js';

const STOREFRONT_REVIEW_TAKE = 10;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- admin ---------------------------------------------------------------

  async adminCreate(productId: string, input: CreateAdminReviewInput) {
    await this.ensureProduct(productId);
    return this.prisma.productReview.create({
      data: {
        productId,
        source: 'ADMIN',
        authorName: input.authorName,
        location: input.location ?? null,
        rating: input.rating,
        title: input.title ?? null,
        comment: input.comment,
        photos: input.photos,
        isVisible: input.isVisible,
      },
    });
  }

  // All rows validated before any insert: one bad row rejects the WHOLE batch
  // with row-scoped errors and zero inserts (all-or-nothing TSV import).
  async adminBatchCreate(productId: string, items: BatchReviewsInput['items']) {
    const parsed: CreateAdminReviewInput[] = [];
    const errors: Array<{ row: number; field: string; message: string }> = [];

    items.forEach((raw, index) => {
      const result = createAdminReviewSchema.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            row: index + 1,
            field: issue.path.join('.') || '(root)',
            message: issue.message,
          });
        }
      } else {
        parsed.push(result.data);
      }
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        message: '有评论行未通过校验，未导入任何评论',
        errors,
      });
    }

    await this.ensureProduct(productId);

    await this.prisma.$transaction(
      parsed.map((input) =>
        this.prisma.productReview.create({
          data: {
            productId,
            source: 'ADMIN',
            authorName: input.authorName,
            location: input.location ?? null,
            rating: input.rating,
            title: input.title ?? null,
            comment: input.comment,
            photos: input.photos,
            isVisible: input.isVisible,
          },
        }),
      ),
    );

    return { created: parsed.length };
  }

  async adminListForProduct(productId: string) {
    await this.ensureProduct(productId);
    return this.prisma.productReview.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async adminUpdate(id: string, input: UpdateAdminReviewInput) {
    await this.ensureReview(id);
    // Map null to null (clear), undefined is omitted by Prisma automatically.
    return this.prisma.productReview.update({
      where: { id },
      data: {
        ...(input.authorName !== undefined && { authorName: input.authorName }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.comment !== undefined && { comment: input.comment }),
        ...(input.photos !== undefined && { photos: input.photos }),
        ...(input.isVisible !== undefined && { isVisible: input.isVisible }),
      },
    });
  }

  async adminRemove(id: string) {
    await this.ensureReview(id);
    await this.prisma.productReview.delete({ where: { id } });
  }

  // --- storefront ----------------------------------------------------------

  async storefrontForProduct(
    productId: string,
  ): Promise<{ reviews: StorefrontReviewShape[] } & RatingSummary> {
    // The reviews[] page is capped at 10, but count/average MUST span all
    // visible reviews (spec: the cap applies to the list, not the summary),
    // so run the page query and the aggregate in parallel.
    const [rows, agg] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { productId, isVisible: true },
        orderBy: { createdAt: 'desc' },
        take: STOREFRONT_REVIEW_TAKE,
      }),
      this.prisma.productReview.aggregate({
        where: { productId, isVisible: true },
        _count: { _all: true },
        _avg: { rating: true },
      }),
    ]);
    const avg = agg._avg.rating;
    return {
      reviews: rows.map(serializeReview),
      reviewCount: agg._count._all,
      ratingAverage: avg === null ? null : Math.round(avg * 10 + Number.EPSILON) / 10,
    };
  }

  /** Visible-only averages for a batch of products (list pages/cards). */
  async summaryForProducts(productIds: string[]): Promise<Map<string, RatingSummary>> {
    const result = new Map<string, RatingSummary>();
    if (productIds.length === 0) return result;

    const grouped = await this.prisma.productReview.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, isVisible: true },
      _avg: { rating: true },
      _count: { _all: true },
    });

    for (const row of grouped) {
      // groupBy gives the exact average; round at the edge like the helper.
      const avg = row._avg.rating;
      result.set(row.productId, {
        reviewCount: row._count._all,
        ratingAverage: avg === null ? null : Math.round(avg * 10 + Number.EPSILON) / 10,
      });
    }
    return result;
  }

  // --- internal ------------------------------------------------------------

  private async ensureProduct(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
  }

  private async ensureReview(id: string): Promise<void> {
    const review = await this.prisma.productReview.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!review) throw new NotFoundException('Review not found');
  }
}
