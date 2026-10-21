import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { variantCardMediaSchema } from './variant-card-media.js';

export interface CardReadinessProduct {
  id: string;
  name: string;
  defaultDisplayVariantId: string | null;
  variants: readonly {
    id: string;
    name: string;
    cardMedia?: unknown;
    sku: { status: string; price: unknown } | null;
  }[];
}

export interface ProductCardReadinessIssue {
  productId: string;
  productName: string;
  missingCoverVariants: Array<{ variantId: string; name: string }>;
  defaultDisplayVariantMissing: boolean;
}

export async function validateProductCardReadiness(
  tx: Prisma.TransactionClient,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const products = await tx.product.findMany({
    where: { id: { in: [...productIds] }, status: 'ACTIVE' },
    select: {
      id: true, name: true, defaultDisplayVariantId: true,
      variants: { select: { id: true, name: true, cardMedia: true, sku: { select: { status: true, price: true } } } },
    },
  });
  const issues = findProductCardReadinessIssues(products);
  if (issues.length === 0) return;
  const details = issues.map(issue => {
    const reasons = [];
    if (issue.missingCoverVariants.length > 0) reasons.push(`Missing card cover: ${issue.missingCoverVariants.map(row => row.name).join(', ')}`);
    if (issue.defaultDisplayVariantMissing) reasons.push('Choose a default display variant');
    return `${issue.productName}: ${reasons.join('; ')}`;
  }).join(' | ');
  throw new BadRequestException({ code: 'PRODUCT_CARD_MEDIA_INCOMPLETE', message: details, products: issues });
}

export function findProductCardReadinessIssues(
  products: readonly CardReadinessProduct[],
): ProductCardReadinessIssue[] {
  return products.flatMap(product => {
    const selectable = product.variants.filter(variant => variant.sku?.status === 'ACTIVE' && variant.sku.price != null);
    const missingCoverVariants = selectable.filter(variant => {
      const parsed = variantCardMediaSchema.safeParse(variant.cardMedia);
      return !parsed.success || parsed.data.cover === null;
    }).map(variant => ({ variantId: variant.id, name: variant.name }));
    const defaultDisplayVariantMissing = selectable.length >= 2 &&
      !selectable.some(variant => variant.id === product.defaultDisplayVariantId);
    return missingCoverVariants.length > 0 || defaultDisplayVariantMissing ? [{
      productId: product.id, productName: product.name, missingCoverVariants, defaultDisplayVariantMissing,
    }] : [];
  });
}
