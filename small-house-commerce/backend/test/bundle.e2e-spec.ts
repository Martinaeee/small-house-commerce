import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { PermissionCode, RoleCode } from '../src/generated/prisma/client.js';

const database = process.env.BUNDLE_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
      (url.port && url.port !== '5432') ||
      !/^small_house_bundle_20261016_[a-z0-9]+$/.test(url.pathname.slice(1))) {
    throw new Error('Bundle API E2E requires the dedicated local Bundle database');
  }
}
const API = 'http://127.0.0.1:3240/api/v1';

describe.skipIf(!database || process.env.BUNDLE_E2E !== '1')('Bundle API on owned runtime 3240', () => {
  const prefix = `bundle-api-${randomUUID()}`;
  const phones = new Set<string>();
  const carts = new Set<string>();
  const users: string[] = [];
  const roles: string[] = [];
  const permissions: string[] = [];
  const grants: { roleId: string; permissionId: string }[] = [];
  let prisma: PrismaService;
  let categoryId: string;
  let warehouseId: string;
  let ownedWarehouse = false;
  let adminToken: string;
  let deniedToken: string;
  let serial = 0;

  async function request(route: string, method = 'GET', body?: unknown, token?: string) {
    return fetch(`${API}${route}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function json(response: Response, status = 200) {
    expect(response.status).toBe(status);
    return response.json();
  }

  async function login(code: RoleCode, allowed: PermissionCode[]) {
    let role = await prisma.role.findUnique({ where: { code } });
    if (!role) {
      role = await prisma.role.create({ data: { code, name: prefix } });
      roles.push(role.id);
    }
    for (const permissionCode of allowed) {
      let permission = await prisma.permission.findUnique({ where: { code: permissionCode } });
      if (!permission) {
        permission = await prisma.permission.create({ data: { code: permissionCode } });
        permissions.push(permission.id);
      }
      const key = { roleId: role.id, permissionId: permission.id };
      if (!await prisma.rolePermission.findUnique({ where: { roleId_permissionId: key } })) {
        await prisma.rolePermission.create({ data: key });
        grants.push(key);
      }
    }
    const password = randomBytes(24).toString('hex');
    const email = `${randomUUID()}@bundle-api.local`;
    const user = await prisma.user.create({ data: {
      email, name: prefix, passwordHash: await argon2.hash(password), roles: { create: { roleId: role.id } },
    } });
    users.push(user.id);
    const response = await request('/auth/login', 'POST', { email, password });
    expect(response.status).toBe(200);
    const session = await response.json();
    if (typeof session.accessToken !== 'string') throw new Error('Normal login did not produce an access token');
    return session.accessToken;
  }

  async function cleanup() {
    if (carts.size > 0) await prisma.cart.deleteMany({ where: { id: { in: [...carts] } } });
    const orderRows = await prisma.order.findMany({ where: { customer: { normalizedPhone: { in: [...phones] } } }, select: { id: true } });
    const orderIds = orderRows.map(order => order.id);
    if (orderIds.length > 0) {
      await prisma.shipmentItem.deleteMany({ where: { shipment: { orderId: { in: orderIds } } } });
      await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderMergeRecord.deleteMany({ where: { OR: [{ primaryOrderId: { in: orderIds } }, { mergedOrderId: { in: orderIds } }] } });
      await prisma.inventoryReservation.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.inventoryMovement.deleteMany({ where: { referenceId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (phones.size > 0) await prisma.customer.deleteMany({ where: { normalizedPhone: { in: [...phones] } } });
    const skus = await prisma.sku.findMany({ where: { product: { categoryId } }, select: { id: true } });
    const skuIds = skus.map(sku => sku.id);
    await prisma.skuBundleComponent.deleteMany({ where: { OR: [{ bundleSkuId: { in: skuIds } }, { componentSkuId: { in: skuIds } }] } });
    await prisma.inventoryMovement.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.inventory.deleteMany({ where: { skuId: { in: skuIds } } });
    await prisma.product.updateMany({ where: { categoryId }, data: { defaultDisplayVariantId: null } });
    await prisma.product.deleteMany({ where: { categoryId } });
    carts.clear();
    phones.clear();
  }

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    categoryId = (await prisma.category.create({ data: { name: prefix, slug: prefix, status: 'ACTIVE' } })).id;
    let warehouse = await prisma.warehouse.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    if (!warehouse) {
      warehouse = await prisma.warehouse.create({ data: { name: prefix } });
      ownedWarehouse = true;
    }
    warehouseId = warehouse.id;
    adminToken = await login('ADMIN', ['PRODUCT_MANAGE', 'INVENTORY_VIEW', 'INVENTORY_ADJUST', 'ORDER_VIEW_ALL', 'ORDER_CONFIRM', 'ORDER_CANCEL', 'SHIPMENT_CREATE']);
    deniedToken = await login('WAREHOUSE', ['INVENTORY_VIEW']);
  });

  beforeEach(async () => { await cleanup(); });
  afterEach(async () => { await cleanup(); });
  afterAll(async () => {
    if (!prisma) return;
    try {
      if (categoryId) {
        await cleanup();
        await prisma.category.delete({ where: { id: categoryId } });
      }
      if (ownedWarehouse) await prisma.warehouse.delete({ where: { id: warehouseId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      for (const grant of grants) await prisma.rolePermission.deleteMany({ where: grant });
      await prisma.role.deleteMany({ where: { id: { in: roles } } });
      await prisma.permission.deleteMany({ where: { id: { in: permissions } } });
    } finally {
      adminToken = '';
      deniedToken = '';
      await prisma.$disconnect();
    }
  });

  async function sku(label: string, onHand: number | null, price: number) {
    const key = `${prefix}-${label}-${serial++}`;
    const product = await prisma.product.create({ data: { categoryId, name: key, slug: key, status: 'ACTIVE' } });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name: 'Default', combinationKey: 'default' } });
    const result = await prisma.sku.create({ data: { productId: product.id, variantId: variant.id, skuCode: key, price, isBundle: onHand === null } });
    if (onHand !== null) await prisma.inventory.create({ data: { skuId: result.id, warehouseId, onHand } });
    return { product, sku: result };
  }

  async function fixture(onHand = 9) {
    const chair = await sku('chair', onHand, 1499);
    const table = await sku('table', 5, 1999);
    const bundle = await sku('set', null, 2499);
    const definition = `/admin/products/${bundle.product.id}/bundles/${bundle.sku.id}`;
    const components = [{ componentSkuId: chair.sku.id, quantity: 2, position: 0 }, { componentSkuId: table.sku.id, quantity: 1, position: 1 }];
    await json(await request(definition, 'PUT', { expectedVersion: 0, components }, adminToken));
    return { chair, table, bundle, definition, components };
  }

  function checkoutInput(items: { skuId: string; quantity: number }[]) {
    const phone = `+63995${String((Date.now() + serial++) % 10000000).padStart(7, '0')}`;
    phones.add(phone);
    return { customer: { name: prefix, phone, province: 'Metro Manila', city: 'Quezon City', streetAddress: '1 Bundle API St' }, items, attribution: { sourceType: 'ORGANIC' } };
  }

  async function checkout(input: ReturnType<typeof checkoutInput>) {
    const response = await json(await request('/storefront/orders', 'POST', input), 201);
    return prisma.order.findUniqueOrThrow({ where: { orderNumber: response.orderNumber }, include: { items: true } });
  }

  async function stock(skuId: string) {
    return prisma.inventory.findUniqueOrThrow({ where: { skuId_warehouseId: { skuId, warehouseId } } });
  }

  it('enforces ordinary-role permissions, definition CAS and invalid-component validation', async () => {
    const h = await fixture();
    expect((await request(h.definition)).status).toBe(401);
    expect((await request(h.definition, 'GET', undefined, deniedToken)).status).toBe(403);
    expect((await request(h.definition, 'PUT', { expectedVersion: 1, components: h.components }, deniedToken)).status).toBe(403);
    expect((await request(h.definition, 'PUT', { expectedVersion: 0, components: h.components }, adminToken)).status).toBe(409);
    for (const components of [[], [h.components[0], h.components[0]], [{ ...h.components[0], quantity: 0 }], [{ componentSkuId: h.bundle.sku.id, quantity: 1, position: 0 }]]) {
      expect((await request(h.definition, 'PUT', { expectedVersion: 1, components }, adminToken)).status).toBe(400);
    }
    const saved = await json(await request(h.definition, 'GET', undefined, adminToken));
    expect(saved.version).toBe(1);
    expect(saved.availableInventory).toBe(4);
    expect(await prisma.inventory.count({ where: { skuId: h.bundle.sku.id } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { skuId: h.bundle.sku.id } })).toBe(0);
  });

  it('keeps one priced Bundle cart/order line and hides its components from customer lookup', async () => {
    const h = await fixture();
    const cart = await json(await request('/storefront/cart/items', 'POST', { skuId: h.bundle.sku.id, quantity: 2 }), 201);
    carts.add(cart.cartId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ skuId: h.bundle.sku.id, quantity: 2, availableInventory: 4, unavailable: false });
    expect(cart.total).toBe(4998);
    expect(JSON.stringify(cart.items)).not.toContain(h.chair.sku.id);
    const input = checkoutInput([{ skuId: h.bundle.sku.id, quantity: 2 }, { skuId: h.chair.sku.id, quantity: 1 }]);
    const order = await checkout(input);
    expect(order.items).toHaveLength(2);
    expect(Number(order.grandTotal)).toBe(6497);
    expect((await stock(h.chair.sku.id)).reserved).toBe(5);
    expect((await stock(h.table.sku.id)).reserved).toBe(2);
    const visible = await json(await request('/storefront/orders/lookup', 'POST', { orderNumber: order.orderNumber, phone: input.customer.phone }));
    expect(visible.items.every((item: object) => !('bundleSnapshot' in item))).toBe(true);
    const detail = await json(await request(`/admin/orders/${order.id}`, 'GET', undefined, adminToken));
    expect(detail.items.find((item: { skuId: string }) => item.skuId === h.bundle.sku.id).bundleSnapshot).toMatchObject({ components: [expect.objectContaining({ componentSkuId: h.chair.sku.id, quantity: 2, totalQuantity: 4 }), expect.objectContaining({ componentSkuId: h.table.sku.id, totalQuantity: 2 })] });
    expect((await request(`/admin/orders/${order.id}/cancel`, 'POST', {}, deniedToken)).status).toBe(403);
    await json(await request(`/admin/orders/${order.id}/cancel`, 'POST', {}, adminToken), 201);
    expect((await stock(h.chair.sku.id)).reserved).toBe(0);
    expect((await stock(h.table.sku.id)).reserved).toBe(0);
  });

  it('uses saved components for edit and partial shipment after a definition change', async () => {
    const h = await fixture();
    const order = await checkout(checkoutInput([{ skuId: h.bundle.sku.id, quantity: 1 }]));
    await json(await request(h.definition, 'PUT', { expectedVersion: 1, components: [{ componentSkuId: h.chair.sku.id, quantity: 5, position: 0 }] }, adminToken));
    await json(await request(`/admin/orders/${order.id}`, 'PATCH', { items: [{ orderItemId: order.items[0]!.id, skuId: h.bundle.sku.id, quantity: 2 }] }, adminToken));
    expect((await stock(h.chair.sku.id)).reserved).toBe(4);
    expect((await stock(h.table.sku.id)).reserved).toBe(2);
    await json(await request(`/admin/orders/${order.id}/confirm`, 'POST', undefined, adminToken), 201);
    await json(await request(`/admin/orders/${order.id}/ship`, 'POST', { carrier: 'LBC', items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }, adminToken), 201);
    await json(await request(`/admin/orders/${order.id}`, 'PATCH', { items: [{ orderItemId: order.items[0]!.id, skuId: h.bundle.sku.id, quantity: 1 }] }, adminToken));
    const chair = await stock(h.chair.sku.id);
    const table = await stock(h.table.sku.id);
    expect([chair.onHand, chair.reserved, table.onHand, table.reserved]).toEqual([7, 0, 4, 0]);
    expect((await request(`/admin/orders/${order.id}/cancel`, 'POST', {}, adminToken)).status).toBe(400);
    expect(await prisma.inventoryMovement.count({ where: { skuId: h.bundle.sku.id } })).toBe(0);
  });

  it('accepts historical order-item IDs and rejects ambiguous SKU-only edits after merge', async () => {
    const h = await fixture(20);
    const input = checkoutInput([{ skuId: h.bundle.sku.id, quantity: 1 }]);
    const first = await checkout(input);
    await json(await request(h.definition, 'PUT', { expectedVersion: 1, components: [{ componentSkuId: h.chair.sku.id, quantity: 3, position: 0 }] }, adminToken));
    const second = await checkout(input);
    await json(await request('/admin/orders/merge', 'POST', { primaryOrderId: first.id, mergedOrderId: second.id }, adminToken), 201);
    expect((await request(`/admin/orders/${first.id}`, 'PATCH', { items: [{ skuId: h.bundle.sku.id, quantity: 2 }] }, adminToken)).status).toBe(400);
    const edited = await json(await request(`/admin/orders/${first.id}`, 'PATCH', { items: [
      { orderItemId: first.items[0]!.id, skuId: h.bundle.sku.id, quantity: 2 },
      { orderItemId: second.items[0]!.id, skuId: h.bundle.sku.id, quantity: 1 },
    ] }, adminToken));
    expect(edited.items).toHaveLength(2);
    expect(Number(edited.grandTotal)).toBe(7497);
    expect((await stock(h.chair.sku.id)).reserved).toBe(7);
    expect((await stock(h.table.sku.id)).reserved).toBe(2);
    await json(await request(`/admin/orders/${first.id}/cancel`, 'POST', {}, adminToken), 201);
    expect((await stock(h.chair.sku.id)).reserved).toBe(0);
    expect((await stock(h.table.sku.id)).reserved).toBe(0);
  });

  it('rejects virtual stock mutation endpoints without ledger side effects', async () => {
    const h = await fixture();
    expect((await request('/admin/inventory/stock', 'PUT', { skuId: h.bundle.sku.id, onHand: 10 }, adminToken)).status).toBe(400);
    expect((await request('/admin/inventory/adjust', 'POST', { skuId: h.bundle.sku.id, quantity: 1 }, adminToken)).status).toBe(400);
    const batch = await json(await request('/admin/inventory/stock/batch', 'PUT', [{ skuId: h.bundle.sku.id, onHand: 10 }], adminToken));
    expect(batch).toEqual([expect.objectContaining({ skuId: h.bundle.sku.id, ok: false })]);
    expect(await prisma.inventory.count({ where: { skuId: h.bundle.sku.id } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { skuId: h.bundle.sku.id } })).toBe(0);
    expect((await stock(h.chair.sku.id)).onHand).toBe(9);
  });

  it('allows exactly one HTTP checkout for the last complete set', async () => {
    const h = await fixture(2);
    const responses = await Promise.all([
      request('/storefront/orders', 'POST', checkoutInput([{ skuId: h.bundle.sku.id, quantity: 1 }])),
      request('/storefront/orders', 'POST', checkoutInput([{ skuId: h.bundle.sku.id, quantity: 1 }])),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 400]);
    expect((await stock(h.chair.sku.id)).reserved).toBe(2);
    expect((await stock(h.table.sku.id)).reserved).toBe(1);
    expect(await prisma.order.count({ where: { items: { some: { skuId: h.bundle.sku.id } } } })).toBe(1);
    expect(await prisma.inventoryReservation.count({ where: { skuId: h.bundle.sku.id } })).toBe(0);
  });
});
