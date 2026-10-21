import { describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { auditProductCards } from './product-card-audit.js';
import type { CardReadinessProduct } from '../src/modules/catalog/product-card-readiness.js';

it('audits ACTIVE products inside a read-only transaction without changing their snapshots', async () => {
  const products: CardReadinessProduct[] = [{
    id: 'p', name: 'Table', defaultDisplayVariantId: null,
    variants: [{ id: 'v', name: 'Single', cardMedia: null, sku: { status: 'ACTIVE', price: 0 } }],
  }];
  const before = structuredClone(products);
  const operations: string[] = [];
  let select: Prisma.ProductFindManyArgs | undefined;
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray) => {
      operations.push(sql.join(''));
      return 0;
    },
    product: {
      findMany: async (query: Prisma.ProductFindManyArgs) => {
        operations.push('SELECT');
        select = query;
        return structuredClone(products);
      },
    },
  };
  const prisma = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) };
  const result = await auditProductCards(prisma as never);
  expect(operations).toEqual(['SET TRANSACTION READ ONLY', 'SELECT']);
  expect(select).toMatchObject({ where: { status: 'ACTIVE' }, select: {
    variants: { select: { cardMedia: true, sku: { select: { status: true, price: true } } } },
  } });
  expect(result).toMatchObject({ checkedProducts: 1, issues: [{ productId: 'p', missingCoverVariants: [{ variantId: 'v' }] }] });
  expect(products).toEqual(before);
});

describe('audit scope', () => {
  it('reports no issues for an empty ACTIVE set', async () => {
    const tx = { $executeRaw: async () => 0, product: { findMany: async () => [] } };
    const prisma = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) };
    expect(await auditProductCards(prisma as never)).toEqual({ checkedProducts: 0, issues: [] });
  });
});
