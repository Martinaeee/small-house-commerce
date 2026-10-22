import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { OrderStatus, PaymentStatus } from '../../generated/prisma/client.js';
import { DashboardService } from './dashboard.service.js';
import { OrdersService } from '../orders/orders.service.js';

/**
 * The dashboard's aggregates are raw SQL, so their window semantics are proven
 * against a real PostgreSQL instead of a mock. The spec is skipped unless it
 * points at the dedicated local dashboard database.
 */
const database = process.env.DASHBOARD_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/small_house_dashboard_dev') {
    throw new Error('Dashboard integration requires the dedicated local dashboard database.');
  }
}

describe.skipIf(!database)('dashboard window semantics on PostgreSQL', () => {
  let prisma: PrismaService;
  let dashboard: DashboardService;
  let orders: OrdersService;
  let userId: string;
  let roleId: string;
  let permissionId: string;
  let createdRole = false;
  let createdPermission = false;
  const tag = randomUUID();

  const customerIds: string[] = [];

  beforeAll(async () => {
    // Pin the clock so the fixture months are always in the past and the
    // window arithmetic cannot drift with the machine's date.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-05T02:00:00.000Z'));
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();

    const permission = await prisma.permission.upsert({
      where: { code: 'ORDER_VIEW_ALL' },
      update: {},
      create: { code: 'ORDER_VIEW_ALL' },
    });
    permissionId = permission.id;
    const role = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    if (role) {
      roleId = role.id;
    } else {
      roleId = (await prisma.role.create({ data: { code: 'ADMIN', name: 'Dashboard integration' } })).id;
      createdRole = true;
    }
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });
    userId = (
      await prisma.user.create({
        data: {
          name: 'Dashboard integration',
          email: `dashboard-${tag}@example.test`,
          passwordHash: 'integration-only-not-a-login-password',
        },
      })
    ).id;
    await prisma.userRole.create({ data: { userId, roleId } });

    dashboard = new DashboardService(prisma, {} as never);
    orders = new OrdersService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never);
  }, 30000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: 'DASH-' } } });
    if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
    if (createdRole) await prisma.role.deleteMany({ where: { id: roleId } });
    if (createdPermission) await prisma.permission.deleteMany({ where: { id: permissionId } });
    await prisma.$disconnect();
    vi.useRealTimers();
  });

  async function customer(label: string): Promise<string> {
    const row = await prisma.customer.create({
      data: { name: `Dashboard ${label}`, normalizedPhone: `dash-${label}-${tag}` },
    });
    customerIds.push(row.id);
    return row.id;
  }

  async function order(
    customerId: string,
    createdAt: string,
    extra: { status?: OrderStatus; payment?: PaymentStatus } = {},
  ) {
    return prisma.order.create({
      data: {
        orderNumber: `DASH-${randomUUID()}`,
        customerId,
        subtotal: '1000.00',
        discountTotal: '0.00',
        shippingTotal: '0.00',
        grandTotal: '1000.00',
        orderStatus: extra.status ?? 'NEW',
        paymentStatus: extra.payment ?? 'COD_PENDING',
        createdAt: new Date(createdAt),
      },
    });
  }

  it('counts the customer snapshot inside the selected period', async () => {
    const repeat = await customer('repeat');
    const returning = await customer('returning');
    const single = await customer('single');

    await order(repeat, '2026-09-05T03:00:00Z'); // Manila 09-05 11:00
    await order(repeat, '2026-09-20T03:00:00Z'); // Manila 09-20 11:00
    await order(returning, '2026-08-10T03:00:00Z'); // before the period
    await order(returning, '2026-09-10T03:00:00Z');
    await order(single, '2026-09-12T03:00:00Z');

    const september = await dashboard.overview(userId, {
      range: 'CUSTOM',
      from: '2026-09-01',
      to: '2026-09-30',
      sort: 'revenue',
    });

    expect(september.customerSnapshot).toMatchObject({
      newCustomers: 2, // repeat + single: their first valid order is in September
      returningCustomers: 1, // returning had ordered in August
      repeatCustomers: 2, // repeat and returning have 2+ valid orders in total
      periodCustomers: 3, // the period's customers: new + returning
      repeatPurchaseRate: 0.6667,
    });

    const october = await dashboard.overview(userId, {
      range: 'CUSTOM',
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'revenue',
    });

    // An empty period reports "no rate" — never the historical one.
    expect(october.customerSnapshot).toMatchObject({
      newCustomers: 0,
      returningCustomers: 0,
      repeatCustomers: 0,
      periodCustomers: 0,
      repeatPurchaseRate: null,
    });
  });

  it('reads the order list From/To as Manila calendar days', async () => {
    const buyer = await customer('buyer');
    const inside = await order(buyer, '2026-09-14T17:00:00Z'); // Manila 09-15 01:00
    const insideLate = await order(buyer, '2026-09-15T15:30:00Z'); // Manila 09-15 23:30
    const before = await order(buyer, '2026-09-14T15:00:00Z'); // Manila 09-14 23:00
    const after = await order(buyer, '2026-09-15T16:00:00Z'); // Manila 09-16 00:00

    const page = await orders.list({
      dateFrom: '2026-09-15',
      dateTo: '2026-09-15',
      page: 1,
      pageSize: 100,
    });

    const numbers = page.items.map((item) => item.orderNumber);
    expect(numbers).toContain(inside.orderNumber);
    expect(numbers).toContain(insideLate.orderNumber);
    expect(numbers).not.toContain(before.orderNumber);
    expect(numbers).not.toContain(after.orderNumber);
  });

  it('filters the order list by the payment status the dashboard links with', async () => {
    const buyer = await customer('payer');
    const failed = await order(buyer, '2026-09-11T03:00:00Z', { payment: 'FAILED' });
    const paid = await order(buyer, '2026-09-11T04:00:00Z', { payment: 'PAID' });

    const failedPage = await orders.list({ paymentStatus: ['FAILED'], page: 1, pageSize: 100 });
    const failedNumbers = failedPage.items.map((item) => item.orderNumber);
    expect(failedNumbers).toContain(failed.orderNumber);
    expect(failedNumbers).not.toContain(paid.orderNumber);

    const paidPage = await orders.list({ paymentStatus: ['PAID'], page: 1, pageSize: 100 });
    const paidNumbers = paidPage.items.map((item) => item.orderNumber);
    expect(paidNumbers).toContain(paid.orderNumber);
    expect(paidNumbers).not.toContain(failed.orderNumber);
  });

  it('links the order tiles to the Manila days it counted', async () => {
    const result = await dashboard.overview(userId, {
      range: 'CUSTOM',
      from: '2026-09-01',
      to: '2026-09-30',
      sort: 'revenue',
    });

    const tile = result.ordersOverview.tiles.find((row) => row.key === 'TO_FULFILL')!;
    const params = new URL(tile.href, 'http://admin.test').searchParams;
    expect(params.get('dateFrom')).toBe('2026-09-01');
    expect(params.get('dateTo')).toBe('2026-09-30');
  });
});
