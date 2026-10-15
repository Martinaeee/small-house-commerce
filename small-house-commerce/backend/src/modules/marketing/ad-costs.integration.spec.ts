import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdCostsService } from './ad-costs.service.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { OptimizersService } from './optimizers.service.js';

const database = process.env.MARKETING_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/small_house_marketing_dev') throw new Error('Cost integration requires the dedicated local marketing database.');
}

describe.skipIf(!database)('advertising costs PostgreSQL transactions', () => {
  let prisma: PrismaService;
  let costs: AdCostsService;
  let ownerId: string;
  let adminId: string;
  let productId: string;
  let categoryId: string;
  const tag = randomUUID();
  const own = () => ({ id: ownerId, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });
  const admin = () => ({ id: adminId, permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] });
  const finance = () => ({ id: adminId, permissions: ['MARKETING_VIEW_ALL'] });

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    ownerId = (await prisma.user.create({ data: { name: 'Cost owner', email: `cost-owner-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    adminId = (await prisma.user.create({ data: { name: 'Cost admin', email: `cost-admin-${tag}@example.test`, passwordHash: 'integration-only-not-a-login-password' } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'Cost integration', slug: `cost-${tag}` } })).id;
    productId = (await prisma.product.create({ data: { categoryId, name: 'Cost parent', slug: `cost-${tag}`, productCode: `COST-${tag}`, status: 'ACTIVE', solutions: [] } })).id;
    costs = new AdCostsService(prisma, new CampaignLinksService(prisma, new OptimizersService(prisma)));
  }, 20000);

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  afterAll(async () => {
    if (!prisma) return;
    if (productId) {
      const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('public.cost_entries') IS NOT NULL AS present`;
      if (present) {
        await prisma.adCostAudit.deleteMany({ where: { cost: { link: { productId } } } });
        await prisma.adCostEntry.deleteMany({ where: { link: { productId } } });
      }
      await prisma.campaignLink.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  async function input() {
    const link = await prisma.campaignLink.create({ data: { code: randomUUID().replaceAll('-', '').slice(0, 16), name: 'Cost ad', ownerUserId: ownerId, aidSnapshot: 'COST-OWNER', productId, sourceType: 'META_AD', createdAt: new Date('2026-10-09T16:00:00Z') } });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T16:30:00Z'));
    return { linkId: link.id, costDate: '2026-10-10', amountUsd: '50.00', phpPerUsd: '57.3' };
  }

  it('keeps one expense and one audit after concurrent initial creates', async () => {
    const base = await input();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => costs.upsertCost(base, own())));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    const row = await prisma.adCostEntry.findFirstOrThrow({ where: { linkId: base.linkId } });
    expect(row.ownerUserId).toBe(ownerId);
    expect(row.amountPhp.toFixed(2)).toBe('2865.00');
    expect(await prisma.adCostEntry.count({ where: { linkId: base.linkId } })).toBe(1);
    expect(await prisma.adCostAudit.count({ where: { costEntryId: row.id } })).toBe(1);
  }, 20000);

  it('allows one concurrent correction and preserves the losing version as a conflict', async () => {
    const base = await input();
    const original = await costs.upsertCost(base, own());
    const results = await Promise.allSettled(['60.00', '70.00'].map(amountUsd => costs.upsertCost({ ...base, amountUsd, expectedVersion: original.version }, own())));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const row = await prisma.adCostEntry.findUniqueOrThrow({ where: { id: original.id } });
    expect(row.version).toBe(1);
    const audit = await costs.auditHistory(row.id, finance());
    expect(audit).toHaveLength(2);
    expect(audit.find(entry => entry.action === 'UPDATE')).toMatchObject({ before: { amountUsd: '50.00', phpPerUsd: '57.300000' }, after: { amountUsd: row.amountUsd.toFixed(2), version: 1 } });
  });

  it('rolls back a real correction transaction when its audit append fails', async () => {
    const base = await input();
    const original = await costs.upsertCost(base, own());
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementation(((work: (tx: unknown) => Promise<unknown>) => transaction(async tx => work(new Proxy(tx, { get(target, key, receiver) { return key === 'adCostAudit' ? { create: async () => { throw new Error('audit append unavailable'); } } : Reflect.get(target, key, receiver); } })))) as never);
    await expect(costs.upsertCost({ ...base, amountUsd: '99.00', expectedVersion: 0 }, own())).rejects.toThrow('audit append unavailable');
    const saved = await prisma.adCostEntry.findUniqueOrThrow({ where: { id: original.id } });
    expect(saved.version).toBe(0);
    expect(saved.amountUsd.toFixed(2)).toBe('50.00');
    expect(await prisma.adCostAudit.count({ where: { costEntryId: original.id } })).toBe(1);
  });

  it('distinguishes zero from missing and retains void history through explicit reactivation', async () => {
    const base = await input();
    expect((await costs.listCosts({ linkId: base.linkId, includeVoided: false, page: 1, pageSize: 20 }, own())).total).toBe(0);
    const zero = await costs.upsertCost({ ...base, amountUsd: '0.00', phpPerUsd: null }, admin());
    expect(zero).toMatchObject({ ownerUserId: ownerId, createdById: adminId, phpPerUsd: null, amountPhp: '0.00' });
    expect((await costs.listCosts({ linkId: base.linkId, includeVoided: false, page: 1, pageSize: 20 }, own())).total).toBe(1);
    await costs.voidCost(zero.id, 0, own());
    expect((await costs.listCosts({ linkId: base.linkId, includeVoided: false, page: 1, pageSize: 20 }, own())).total).toBe(0);
    expect((await costs.listCosts({ linkId: base.linkId, includeVoided: true, page: 1, pageSize: 20 }, finance())).total).toBe(1);
    const restored = await costs.upsertCost({ ...base, amountUsd: '0.01', phpPerUsd: '56.5', expectedVersion: 1 }, own());
    expect(restored).toMatchObject({ id: zero.id, amountPhp: '0.57', version: 2, voidedAt: null });
    expect(await costs.auditHistory(zero.id, finance())).toHaveLength(3);
  });

  it('enforces Manila creation/today bounds, FX positivity and converted PHP precision', async () => {
    const base = await input();
    for (const extra of [{ costDate: '2026-10-09' }, { costDate: '2026-10-12' }, { phpPerUsd: '0' }, { phpPerUsd: null }, { amountUsd: '9999999999.99', phpPerUsd: '999999.999999' }]) {
      await expect(costs.upsertCost({ ...base, ...extra }, own())).rejects.toMatchObject({ status: 400 });
    }
    expect(await prisma.adCostEntry.count({ where: { linkId: base.linkId } })).toBe(0);
    expect(await costs.upsertCost({ ...base, costDate: '2026-10-11' }, own())).toMatchObject({ costDate: '2026-10-11' });
  });

  it('isolates owner lists and audit reads while keeping finance and broad readers unable to write', async () => {
    const base = await input();
    const row = await costs.upsertCost(base, own());
    const foreign = { id: adminId, permissions: own().permissions };
    expect(await costs.listCosts({ linkId: base.linkId, includeVoided: true, page: 1, pageSize: 20 }, foreign)).toMatchObject({ items: [], total: 0 });
    await expect(costs.auditHistory(row.id, foreign)).rejects.toMatchObject({ status: 404 });
    await expect(costs.voidCost(row.id, 0, foreign)).rejects.toMatchObject({ status: 404 });
    await expect(costs.upsertCost({ ...base, expectedVersion: 0 }, finance())).rejects.toMatchObject({ status: 403 });
    await expect(costs.upsertCost({ ...base, expectedVersion: 0 }, { ...finance(), permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_OWN'] })).rejects.toMatchObject({ status: 404 });
    expect(await costs.auditHistory(row.id, finance())).toHaveLength(1);
    expect((await prisma.adCostEntry.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(0);
  });
});
