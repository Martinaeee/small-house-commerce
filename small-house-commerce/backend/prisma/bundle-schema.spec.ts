import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const database = process.env.BUNDLE_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/small_house_bundle_20261016_[a-z0-9]+$/.test(url.pathname)) {
    throw new Error('Bundle schema tests require their owned local Bundle database.');
  }
}
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

describe.skipIf(!database)('Bundle PostgreSQL schema invariants', () => {
  let prisma: PrismaService;
  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
  });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  async function rollback(work: (tx: Prisma.TransactionClient) => Promise<void>) {
    const marker = new Error('Owned Bundle schema transaction rollback');
    await expect(prisma.$transaction(async tx => {
      await work(tx);
      throw marker;
    })).rejects.toBe(marker);
  }

  async function insert(tx: Prisma.TransactionClient, quantity = 2, position = 0, componentSkuId = id(6)) {
    return tx.$executeRaw`INSERT INTO sku_bundle_components(id,bundle_sku_id,component_sku_id,quantity,position,updated_at) VALUES(${randomUUID()}::uuid,${id(5)}::uuid,${componentSkuId}::uuid,${quantity},${position},now())`;
  }

  it('keeps pre-migration SKU facts ordinary and order history null', async () => {
    expect(await prisma.$queryRaw`SELECT is_bundle,bundle_version,product_width,product_depth,product_height,price::text FROM skus WHERE id=${id(5)}::uuid`).toEqual([
      { is_bundle: false, bundle_version: 0, product_width: 120, product_depth: 60, product_height: 75, price: '1499.00' },
    ]);
    expect(await prisma.$queryRaw`SELECT bundle_snapshot FROM order_items WHERE id=${id(10)}::uuid`).toEqual([{ bundle_snapshot: null }]);
  });

  it('round-trips a concrete component definition with stable identity and ordering', async () => {
    await rollback(async tx => {
      await tx.$executeRaw`UPDATE skus SET is_bundle=true WHERE id=${id(5)}::uuid`;
      await insert(tx);
      expect(await tx.$queryRaw`SELECT component_sku_id,quantity,position FROM sku_bundle_components WHERE bundle_sku_id=${id(5)}::uuid`).toEqual([
        { component_sku_id: id(6), quantity: 2, position: 0 },
      ]);
    });
  });

  it.each([0, -1, 1001])('rejects out-of-range component quantity %s in PostgreSQL', async quantity => {
    await expect(prisma.$transaction(tx => insert(tx, quantity))).rejects.toThrow(/check constraint|23514/i);
  });

  it('rejects negative ordering in PostgreSQL', async () => {
    await expect(prisma.$transaction(tx => insert(tx, 1, -1))).rejects.toThrow(/check constraint|23514/i);
  });

  it('rejects a direct self-binding in PostgreSQL', async () => {
    await expect(prisma.$transaction(tx => insert(tx, 1, 0, id(5)))).rejects.toThrow(/check constraint|23514/i);
  });

  it('rejects missing component identities in PostgreSQL', async () => {
    await expect(prisma.$transaction(tx => insert(tx, 1, 0, randomUUID()))).rejects.toThrow(/foreign key|23503/i);
  });

  it('rejects duplicate component bindings independently of their quantity and position', async () => {
    await expect(prisma.$transaction(async tx => {
      await insert(tx);
      await insert(tx, 3, 1);
    })).rejects.toThrow(/unique constraint|23505/i);
  });

  it('prevents deletion of a currently referenced component SKU', async () => {
    await expect(prisma.$transaction(async tx => {
      await insert(tx);
      await tx.$executeRaw`DELETE FROM inventory WHERE sku_id=${id(6)}::uuid`;
      await tx.$executeRaw`DELETE FROM skus WHERE id=${id(6)}::uuid`;
    })).rejects.toThrow(/sku_bundle_components_component_sku_id_fkey/i);
  });

  it('deletes only owned definition rows when a Bundle SKU is deleted', async () => {
    await rollback(async tx => {
      await tx.$executeRaw`INSERT INTO product_variants(id,product_id,name,combination_key,updated_at) VALUES(${id(15)}::uuid,${id(2)}::uuid,'Cascade owner','legacy:bundle-cascade',now())`;
      await tx.$executeRaw`INSERT INTO skus(id,product_id,variant_id,sku_code,is_bundle,updated_at) VALUES(${id(16)}::uuid,${id(2)}::uuid,${id(15)}::uuid,'BUNDLE-CASCADE-ONLY',true,now())`;
      await tx.$executeRaw`INSERT INTO sku_bundle_components(id,bundle_sku_id,component_sku_id,quantity,position,updated_at) VALUES(${randomUUID()}::uuid,${id(16)}::uuid,${id(6)}::uuid,1,0,now())`;
      await tx.$executeRaw`DELETE FROM skus WHERE id=${id(16)}::uuid`;
      expect(await tx.$queryRaw`SELECT count(*)::int AS count FROM sku_bundle_components WHERE bundle_sku_id=${id(16)}::uuid`).toEqual([{ count: 0 }]);
      expect(await tx.$queryRaw`SELECT id FROM skus WHERE id=${id(6)}::uuid`).toEqual([{ id: id(6) }]);
    });
  });

  it('stores historical component labels without touching customer-visible charges', async () => {
    const snapshot = { version: 1, components: [{ componentSkuId: id(6), quantityPerBundle: 2, totalQuantity: 4, position: 0, skuCode: 'OLD-B', productName: 'Historical table', variantName: 'B' }] };
    await rollback(async tx => {
      await tx.$executeRaw`UPDATE order_items SET bundle_snapshot=${JSON.stringify(snapshot)}::jsonb WHERE id=${id(10)}::uuid`;
      expect(await tx.$queryRaw`SELECT bundle_snapshot,quantity,unit_price::text,line_total::text FROM order_items WHERE id=${id(10)}::uuid`).toEqual([
        { bundle_snapshot: snapshot, quantity: 2, unit_price: '1499.00', line_total: '2998.00' },
      ]);
    });
  });
});
