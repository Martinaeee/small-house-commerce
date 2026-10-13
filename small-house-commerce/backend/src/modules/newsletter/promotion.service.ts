import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CACHE_TAGS,
  revalidateCache,
} from '../../common/revalidation.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { computeDiscount } from './promotion-pricing.js';
import {
  createPromotionSchema,
  type CreatePromotionInput,
  type UpdatePromotionInput,
} from './dto/promotion.dto.js';

export interface ResolvedPromotion {
  id: string;
  code: string;
  rule: { discountType: 'PERCENT' | 'FIXED'; discountValue: number };
  /** True when this successful redemption consumes the final total-use slot. */
  exhaustsTotalLimit: boolean;
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

@Injectable()
export class PromotionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starts a new round: the current ACTIVE promotion is archived and a brand
   * new row (new id, fresh counts) becomes ACTIVE. Archived history and its
   * redemptions are preserved.
   */
  async create(input: CreatePromotionInput) {
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.newsletterPromotion.updateMany({
        where: { status: 'ACTIVE' },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      return tx.newsletterPromotion.create({
        data: {
          code: input.code,
          discountType: input.discountType,
          discountValue: input.discountValue,
          minSpend: input.minSpend,
          maxUses: input.maxUses,
          perCustomerLimit: input.perCustomerLimit,
          validFrom: toDate(input.validFrom) ?? null,
          validUntil: toDate(input.validUntil) ?? null,
        },
      });
    });
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return created;
  }

  /**
   * Edits the promotion in place. The id never changes, so redemption counts
   * keep accumulating — editing the code cannot reset a usage limit.
   */
  async update(id: string, input: UpdatePromotionInput) {
    const existing = await this.prisma.newsletterPromotion.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Promotion not found');
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Archived promotions cannot be edited.');
    }

    const candidate = createPromotionSchema.safeParse({
      code: input.code ?? existing.code,
      discountType: input.discountType ?? existing.discountType,
      discountValue:
        input.discountValue ?? Number(existing.discountValue),
      minSpend: input.minSpend ?? Number(existing.minSpend),
      maxUses:
        input.maxUses !== undefined ? input.maxUses : existing.maxUses,
      perCustomerLimit:
        input.perCustomerLimit !== undefined
          ? input.perCustomerLimit
          : existing.perCustomerLimit,
      validFrom:
        input.validFrom !== undefined
          ? input.validFrom
          : (existing.validFrom?.toISOString() ?? null),
      validUntil:
        input.validUntil !== undefined
          ? input.validUntil
          : (existing.validUntil?.toISOString() ?? null),
    });
    if (!candidate.success) {
      throw new BadRequestException(
        candidate.error.issues[0]?.message ?? 'Invalid promotion update.',
      );
    }
    const merged = candidate.data;

    const updated = await this.prisma.newsletterPromotion.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: merged.code } : {}),
        ...(input.discountType !== undefined
          ? { discountType: merged.discountType }
          : {}),
        ...(input.discountValue !== undefined
          ? { discountValue: merged.discountValue }
          : {}),
        ...(input.minSpend !== undefined
          ? { minSpend: merged.minSpend }
          : {}),
        ...(input.maxUses !== undefined ? { maxUses: merged.maxUses } : {}),
        ...(input.perCustomerLimit !== undefined
          ? { perCustomerLimit: merged.perCustomerLimit }
          : {}),
        ...(input.validFrom !== undefined
          ? { validFrom: toDate(merged.validFrom) ?? null }
          : {}),
        ...(input.validUntil !== undefined
          ? { validUntil: toDate(merged.validUntil) ?? null }
          : {}),
      },
    });
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return updated;
  }

  /** ACTIVE first, then archived history newest-first. */
  async list() {
    return this.prisma.newsletterPromotion.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Authoritative promo validation for checkout (spec §4.3). Runs inside the
   * order transaction: a transaction-scoped advisory lock on the promotion id
   * serializes concurrent checkouts of the same promotion, so two orders can
   * never both claim the last remaining use.
   */
  async resolveForCheckout(
    tx: Prisma.TransactionClient,
    code: string,
    subtotal: number,
    normalizedPhone: string,
  ): Promise<ResolvedPromotion> {
    const promotion = await tx.newsletterPromotion.findFirst({
      where: { status: 'ACTIVE', code: code.trim().toUpperCase() },
    });
    if (!promotion) throw new BadRequestException("That promo code isn't valid.");

    const now = new Date();
    if (promotion.validFrom && promotion.validFrom > now) {
      throw new BadRequestException("This promo code isn't active yet.");
    }
    if (promotion.validUntil && promotion.validUntil < now) {
      throw new BadRequestException('This promo code has expired.');
    }

    const minSpend = Number(promotion.minSpend);
    if (subtotal < minSpend) {
      throw new BadRequestException(
        `This promo code needs a minimum order of ₱${minSpend.toFixed(2)}.`,
      );
    }

    // Lock before counting: the count and the redemption insert below must be
    // atomic with respect to other checkouts using the same promotion.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'promo:' + promotion.id}))`;

    let exhaustsTotalLimit = false;
    if (promotion.maxUses !== null) {
      const used = await tx.promoCodeRedemption.count({
        where: { promotionId: promotion.id, releasedAt: null },
      });
      if (used >= promotion.maxUses) {
        throw new BadRequestException(
          'This promo code has reached its usage limit.',
        );
      }
      exhaustsTotalLimit = used + 1 >= promotion.maxUses;
    }

    if (promotion.perCustomerLimit !== null) {
      const usedByCustomer = await tx.promoCodeRedemption.count({
        where: {
          promotionId: promotion.id,
          normalizedPhone,
          releasedAt: null,
        },
      });
      if (usedByCustomer >= promotion.perCustomerLimit) {
        throw new BadRequestException("You've already used this promo code.");
      }
    }

    return {
      id: promotion.id,
      code: promotion.code,
      rule: {
        discountType: promotion.discountType,
        discountValue: Number(promotion.discountValue),
      },
      exhaustsTotalLimit,
    };
  }

  /**
   * Read-only preview for the checkout form (spec §4.1). Shares the validation
   * order with `resolveForCheckout`, but takes no lock, claims no slot, and
   * does not check the per-customer limit (the shopper's phone may not be
   * entered yet) — the authoritative check runs at order creation.
   */
  async preview(
    code: string,
    subtotal: number,
  ): Promise<{ valid: boolean; discountAmount: number; message: string }> {
    const invalid = (message: string) => ({
      valid: false,
      discountAmount: 0,
      message,
    });

    const promotion = await this.prisma.newsletterPromotion.findFirst({
      where: { status: 'ACTIVE', code: code.trim().toUpperCase() },
    });
    if (!promotion) return invalid("That promo code isn't valid.");

    const now = new Date();
    if (promotion.validFrom && promotion.validFrom > now) {
      return invalid("This promo code isn't active yet.");
    }
    if (promotion.validUntil && promotion.validUntil < now) {
      return invalid('This promo code has expired.');
    }

    const minSpend = Number(promotion.minSpend);
    if (subtotal < minSpend) {
      return invalid(
        `This promo code needs a minimum order of ₱${minSpend.toFixed(2)}.`,
      );
    }

    if (promotion.maxUses !== null) {
      const used = await this.prisma.promoCodeRedemption.count({
        where: { promotionId: promotion.id, releasedAt: null },
      });
      if (used >= promotion.maxUses) {
        return invalid('This promo code has reached its usage limit.');
      }
    }

    return {
      valid: true,
      discountAmount: computeDiscount(
        {
          discountType: promotion.discountType,
          discountValue: Number(promotion.discountValue),
        },
        subtotal,
      ),
      message: '',
    };
  }

  async usage(id: string) {
    const promotion = await this.prisma.newsletterPromotion.findUnique({
      where: { id },
    });
    if (!promotion) throw new NotFoundException('Promotion not found');

    const [effective, released] = await Promise.all([
      this.prisma.promoCodeRedemption.count({
        where: { promotionId: id, releasedAt: null },
      }),
      this.prisma.promoCodeRedemption.count({
        where: { promotionId: id, releasedAt: { not: null } },
      }),
    ]);

    const now = new Date();
    const availability =
      promotion.status === 'ARCHIVED'
        ? 'ARCHIVED'
        : promotion.validFrom && promotion.validFrom > now
          ? 'SCHEDULED'
          : promotion.validUntil && promotion.validUntil < now
            ? 'EXPIRED'
            : promotion.maxUses !== null && effective >= promotion.maxUses
              ? 'EXHAUSTED'
              : 'LIVE';

    return {
      promotionId: id,
      effective,
      released,
      maxUses: promotion.maxUses,
      perCustomerLimit: promotion.perCustomerLimit,
      availability,
    };
  }
}
