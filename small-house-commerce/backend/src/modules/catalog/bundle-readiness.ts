import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  validateBundleDefinition,
  type BundleDefinitionComponent,
} from '../inventory/bundle-inventory.js';

/** One active virtual SKU of the product being written, with its definition. */
export interface BundlePublishRow {
  productId: string;
  productName: string;
  skuId: string;
  skuCode: string;
  components: readonly BundleDefinitionComponent[];
}

export interface BundlePublishIssue {
  productId: string;
  productName: string;
  skus: Array<{ skuId: string; skuCode: string; reason: string }>;
}

export function findBundlePublishIssues(rows: readonly BundlePublishRow[]): BundlePublishIssue[] {
  const issues = new Map<string, BundlePublishIssue>();
  for (const row of rows) {
    const reason = validateBundleDefinition(row.components);
    if (reason === null) continue;
    const issue = issues.get(row.productId) ?? { productId: row.productId, productName: row.productName, skus: [] };
    issue.skus.push({ skuId: row.skuId, skuCode: row.skuCode, reason });
    issues.set(row.productId, issue);
  }
  return [...issues.values()];
}

/**
 * A product may only go ACTIVE while every one of its active virtual SKUs has a
 * usable saved definition: the definition is written by a separate request
 * after the SKU identity exists, so a publish that ran first would expose a
 * Bundle with nothing to sell and nothing to reserve.
 */
export async function validateBundlePublishReadiness(
  tx: Prisma.TransactionClient,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const rows = await tx.sku.findMany({
    where: { productId: { in: [...productIds] }, isBundle: true, status: 'ACTIVE' },
    orderBy: [{ skuCode: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      skuCode: true,
      productId: true,
      product: { select: { name: true } },
      bundleComponents: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          componentSkuId: true,
          quantity: true,
          componentSku: {
            select: {
              status: true,
              isBundle: true,
              variant: { select: { product: { select: { status: true } } } },
            },
          },
        },
      },
    },
  });
  const issues = findBundlePublishIssues(rows.map(row => ({
    productId: row.productId,
    productName: row.product.name,
    skuId: row.id,
    skuCode: row.skuCode,
    components: row.bundleComponents.map(component => ({
      componentSkuId: component.componentSkuId,
      quantity: component.quantity,
      status: component.componentSku.status,
      productStatus: component.componentSku.variant.product.status,
      isBundle: component.componentSku.isBundle,
    })),
  })));
  if (issues.length === 0) return;
  const details = issues
    .map(issue => `${issue.productName}: ${issue.skus.map(sku => `${sku.skuCode} (${sku.reason})`).join(', ')}`)
    .join(' | ');
  throw new BadRequestException({
    code: 'PRODUCT_BUNDLE_DEFINITION_INCOMPLETE',
    message: `Save Bundle components before publishing this product (for a new SKU, save it as a draft first). ${details}`,
    products: issues,
  });
}
