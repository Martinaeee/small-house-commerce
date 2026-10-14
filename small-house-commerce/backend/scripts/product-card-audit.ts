import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { findProductCardReadinessIssues, type ProductCardReadinessIssue } from '../src/modules/catalog/product-card-readiness.js';

export async function auditProductCards(prisma: PrismaClient): Promise<{
  checkedProducts: number;
  issues: ProductCardReadinessIssue[];
}> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const products = await tx.product.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, name: true, defaultDisplayVariantId: true,
        variants: { select: { id: true, name: true, cardMedia: true, sku: { select: { status: true, price: true } } } },
      },
    });
    return { checkedProducts: products.length, issues: findProductCardReadinessIssues(products) };
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await auditProductCards(prisma);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.issues.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Product card audit failed');
    process.exitCode = 1;
  });
}
