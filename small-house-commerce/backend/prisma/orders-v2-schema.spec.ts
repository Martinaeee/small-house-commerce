import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OrderVerificationService } from '../src/modules/orders/verification.service.js';
import { OrderHandoverService } from '../src/modules/orders/handover.service.js';

/**
 * PostgreSQL invariants of the stage-1A verification and handover tables.
 *
 * The spec owns a local database (never a shared or production one) and
 * every test runs inside a transaction it rolls back, so the database is
 * left exactly as it was found.
 */
const database = process.env.ORDERS_V2_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/small_house_orders_v2_[a-z0-9_]+$/.test(url.pathname)
  ) {
    throw new Error('Orders V2 schema tests require their owned local database.');
  }
}

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000a1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000b1';
const OPERATOR_ID = '00000000-0000-4000-8000-0000000000c1';
const LINE_ID = '00000000-0000-4000-8000-0000000000d1';
const SKU_ID = '00000000-0000-4000-8000-0000000000e1';
const CATEGORY_ID = '00000000-0000-4000-8000-0000000000e2';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000e3';
const VARIANT_ID = '00000000-0000-4000-8000-0000000000e4';

describe.skipIf(!database)('Orders V2 verification and handover schema invariants', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    await prisma.$executeRaw`INSERT INTO customers(id,name,normalized_phone,current_risk_level,created_at,updated_at)
      VALUES(${CUSTOMER_ID}::uuid,'Marisol Reyes','+639171224466','NORMAL',now(),now())
      ON CONFLICT (id) DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO categories(id,name,slug,created_at,updated_at)
      VALUES(${CATEGORY_ID}::uuid,'Furniture','furniture',now(),now())
      ON CONFLICT (id) DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO products(id,name,slug,category_id,created_at,updated_at)
      VALUES(${PRODUCT_ID}::uuid,'Foldable Desk','foldable-desk',${CATEGORY_ID}::uuid,now(),now())
      ON CONFLICT (id) DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO product_variants(id,product_id,name,combination_key,created_at,updated_at)
      VALUES(${VARIANT_ID}::uuid,${PRODUCT_ID}::uuid,'Wood-Grain','wood-grain',now(),now())
      ON CONFLICT (id) DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO skus(id,product_id,variant_id,sku_code,price,status,created_at,updated_at)
      VALUES(${SKU_ID}::uuid,${PRODUCT_ID}::uuid,${VARIANT_ID}::uuid,'SKU-FD-140-WN',1499,'ACTIVE',now(),now())
      ON CONFLICT (id) DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO orders(id,order_number,customer_id,order_status,confirmation_status,payment_status,currency,subtotal,discount_total,shipping_total,grand_total,created_at,updated_at)
      VALUES(${ORDER_ID}::uuid,'PH-TEST-1',${CUSTOMER_ID}::uuid,'NEW','UNCONFIRMED','COD_PENDING','PHP',1499,0,0,1499,now(),now())
      ON CONFLICT (id) DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO order_items(id,order_id,sku_id,product_name_snapshot,sku_code_snapshot,variant_snapshot,quantity,unit_price,unit_discount,line_total,created_at)
      VALUES(${LINE_ID}::uuid,${ORDER_ID}::uuid,${SKU_ID}::uuid,'Foldable Desk','SKU-FD-140-WN','Wood-Grain',1,1499,0,1499,now())
      ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM orders WHERE id = ${ORDER_ID}::uuid`;
      await prisma.$executeRaw`DELETE FROM customers WHERE id = ${CUSTOMER_ID}::uuid`;
      await prisma.$executeRaw`DELETE FROM skus WHERE id = ${SKU_ID}::uuid`;
      await prisma.$executeRaw`DELETE FROM product_variants WHERE id = ${VARIANT_ID}::uuid`;
      await prisma.$executeRaw`DELETE FROM products WHERE id = ${PRODUCT_ID}::uuid`;
      await prisma.$executeRaw`DELETE FROM categories WHERE id = ${CATEGORY_ID}::uuid`;
      await prisma.$disconnect();
    }
  });

  async function rollback(work: (tx: Prisma.TransactionClient) => Promise<void>) {
    const marker = new Error('Owned Orders V2 schema transaction rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        await work(tx);
        throw marker;
      }),
    ).rejects.toBe(marker);
  }

  it('leaves historical orders alone: no verification rows and the rule switched off', async () => {
    const rows = await prisma.$queryRaw`SELECT order_status,verification_required,next_follow_up_at FROM orders WHERE id = ${ORDER_ID}::uuid`;
    expect(rows).toEqual([{ order_status: 'NEW', verification_required: false, next_follow_up_at: null }]);
    const items = await prisma.$queryRaw`SELECT count(*)::int AS n FROM order_verification_items WHERE order_id = ${ORDER_ID}::uuid`;
    expect(items).toEqual([{ n: 0 }]);
  });

  it('creates the assignment, the checklist and the event log', async () => {
    await rollback(async (tx) => {
      const service = new OrderVerificationService(tx as unknown as PrismaService);
      const { assignment, items } = await service.assign(ORDER_ID, OPERATOR_ID, {
        assigneeId: OPERATOR_ID,
        priority: 'NORMAL',
        itemKeys: ['phone_valid', 'intent', 'addr_area'],
        customItems: [],
        itemAssignees: [],
      itemNotes: [],
        note: null,
        nextFollowUpAt: null,
      });
      expect(assignment.id).toBeTruthy();
      expect(items).toHaveLength(3);

      const events = await tx.$queryRaw`SELECT type FROM order_verification_events WHERE order_id = ${ORDER_ID}::uuid`;
      expect(events).toEqual([{ type: 'ASSIGNED' }]);
    });
  });

  it('keeps one row per question and refuses a duplicate key', async () => {
    await rollback(async (tx) => {
      const service = new OrderVerificationService(tx as unknown as PrismaService);
      await service.assign(ORDER_ID, OPERATOR_ID, {
        assigneeId: OPERATOR_ID,
        priority: 'NORMAL',
        itemKeys: ['intent'],
        customItems: [],
        itemAssignees: [],
      itemNotes: [],
        note: null,
        nextFollowUpAt: null,
      });
      await expect(
        tx.$executeRaw`INSERT INTO order_verification_items(id,order_id,item_key,category,title_snapshot,required,status,rev,created_at,updated_at)
          VALUES(${randomUUID()}::uuid,${ORDER_ID}::uuid,'intent','CUSTOMER_INFO','确认客户购买意愿',true,'PENDING',1,now(),now())`,
      ).rejects.toThrow();
    });
  });

  it('records a result with its operator and an append-only event', async () => {
    await rollback(async (tx) => {
      const service = new OrderVerificationService(tx as unknown as PrismaService);
      await service.assign(ORDER_ID, OPERATOR_ID, {
        assigneeId: OPERATOR_ID,
        priority: 'HIGH',
        itemKeys: ['intent'],
        customItems: [],
        itemAssignees: [],
      itemNotes: [],
        note: null,
        nextFollowUpAt: null,
      });
      await service.setResult(ORDER_ID, 'intent', OPERATOR_ID, {
        status: 'DONE',
        result: '客户明确确认购买',
      });
      const rows = (await tx.$queryRaw`SELECT status,result,operator_id,subject_fingerprint FROM order_verification_items WHERE order_id = ${ORDER_ID}::uuid AND item_key = 'intent'`) as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).status).toBe('DONE');
      expect((rows[0] as Record<string, unknown>).result).toBe('客户明确确认购买');
      expect((rows[0] as Record<string, unknown>).operator_id).toBe(OPERATOR_ID);
      expect((rows[0] as Record<string, unknown>).subject_fingerprint).toBeTruthy();
    });
  });

  it('records a handover with the lines and the quantities', async () => {
    await rollback(async (tx) => {
      const service = new OrderHandoverService(tx as unknown as PrismaService);
      const event = await service.record(ORDER_ID, OPERATOR_ID, {
        type: 'HANDED_OVER',
        items: [{ orderItemId: LINE_ID, quantity: 1 }],
      });
      expect(event.items).toEqual([
        { orderItemId: LINE_ID, quantity: 1, skuCodeSnapshot: 'SKU-FD-140-WN' },
      ]);
      const summary = await service.summary(ORDER_ID);
      expect(summary.complete).toBe(true);
      expect(summary.outstanding).toEqual([]);
    });
  });

  it('refuses a handover that exceeds the ordered quantity', async () => {
    await rollback(async (tx) => {
      const service = new OrderHandoverService(tx as unknown as PrismaService);
      await expect(
        service.record(ORDER_ID, OPERATOR_ID, {
          type: 'HANDED_OVER',
          items: [{ orderItemId: LINE_ID, quantity: 2 }],
        }),
      ).rejects.toThrow();
    });
  });

  it('exposes the enums the workbench needs', async () => {
    const categories = await prisma.$queryRaw`SELECT enumlabel FROM pg_enum WHERE enumtypid = '"VerificationCategory"'::regtype ORDER BY enumlabel`;
    expect((categories as { enumlabel: string }[]).map((r) => r.enumlabel)).toEqual([
      'COD_PAYMENT',
      'CUSTOMER_INFO',
      'DELIVERY_SCHEDULE',
      'OTHER',
      'PRODUCT_INFO',
      'RISK_REVIEW',
      'SHIPPING_ADDRESS',
    ]);
    const statuses = await prisma.$queryRaw`SELECT enumlabel FROM pg_enum WHERE enumtypid = '"VerificationItemStatus"'::regtype ORDER BY enumlabel`;
    expect((statuses as { enumlabel: string }[]).map((r) => r.enumlabel)).toEqual([
      'DONE',
      'INVALIDATED',
      'PENDING',
      'PROBLEM',
      'SKIPPED',
    ]);
  });
});
