import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Finds the single promotion the storefront may truthfully advertise now.
 * An ACTIVE row that is outside its validity window or has exhausted its total
 * redemption limit is not an available offer.
 */
export async function findAvailableNewsletterPromotion(
  prisma: PrismaService,
  now = new Date(),
) {
  const promotion = await prisma.newsletterPromotion.findFirst({
    where: {
      status: 'ACTIVE',
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    },
  });
  if (!promotion || promotion.code.trim() === '') return null;
  if (promotion.maxUses === null) return promotion;

  const effective = await prisma.promoCodeRedemption.count({
    where: { promotionId: promotion.id, releasedAt: null },
  });
  return effective < promotion.maxUses ? promotion : null;
}
